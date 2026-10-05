import {
  WaClient,
  delay,
  isGroupJid,
  type WaClientProxyOptions,
  type WaClientEventMap,
  type WaGroupMetadata,
  type WaMessageKey,
  type WaSendMessageContent,
  type WaSendMessageOptions,
} from 'zapo-js'
import { createMediaProcessor } from '@zapo-js/media-utils'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { version as zapoVersion } from 'zapo-js/package.json'
import type { Config } from './config'
import type { Store } from './store'
import type { OnDisconnected, OnNewLogin, OnNotification, OnQrCode, OnReconnect, Status } from './socket'
import { getStoreZapo } from './store_zapo'
import { zapoLogger } from './logger_zapo'
import logger from './logger'
import { isIndividualJid, jidToPhoneNumber, phoneNumberToJid } from './transformer'
import { SendError } from './send_error'
import { t } from '../i18n'
import {
  CLEAN_CONFIG_ON_DISCONNECT,
  CONFIG_SESSION_PHONE_CLIENT,
  CONFIG_SESSION_PHONE_NAME,
  CONNECTING_TIMEOUT_MS,
  MAX_CONNECT_RETRY,
  MAX_CONNECT_TIME,
  VALIDATE_SESSION_NUMBER,
} from '../defaults'

const mediaProcessor = createMediaProcessor()

type ZapoLifecycleClient = Pick<WaClient, 'disconnect' | 'getCredentials' | 'logout'>

export const logoutOrDisconnectZapo = async (client: ZapoLifecycleClient) => {
  if (!client.getCredentials()?.meJid) {
    await client.disconnect()
    return 'disconnect' as const
  }
  try {
    await client.logout()
    return 'logout' as const
  } catch (error) {
    logger.warn(error, 'O logout Zapo falhou; encerrando a conexão local com segurança.')
    await client.disconnect()
    return 'disconnect' as const
  }
}

export type ZapoSendOptions = WaSendMessageOptions & {
  composing?: boolean
  broadcast?: boolean
  statusJidList?: string[]
}

export type ZapoSocket = {
  client: WaClient
  status: Status
  start: () => Promise<boolean>
  close: () => Promise<void>
  logout: () => Promise<void>
  send: (to: string, content: WaSendMessageContent, options?: ZapoSendOptions) => Promise<unknown>
  read: (keys: WaMessageKey[]) => Promise<boolean>
  exists: (jid: string) => Promise<string | undefined>
  fetchImageUrl: (jid: string) => Promise<string | undefined>
  fetchGroupMetadata: (jid: string) => Promise<WaGroupMetadata | undefined>
}

const buildProxy = (proxyUrl: string | undefined): WaClientProxyOptions | undefined => {
  if (!proxyUrl) {
    return undefined
  }
  const agent = proxyUrl.startsWith('socks') ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl)
  const proxyAgent = agent as unknown as WaClientProxyOptions['ws']
  return {
    ws: proxyAgent,
    mediaUpload: proxyAgent,
    mediaDownload: proxyAgent,
  }
}

export const createSocketZapo = ({
  phone,
  store,
  config,
  attempts,
  time,
  onQrCode,
  onNotification,
  onDisconnected,
  onReconnect,
  onNewLogin,
}: {
  phone: string
  store: Store
  config: Config
  attempts: number
  time: number
  onQrCode: OnQrCode
  onNotification: OnNotification
  onDisconnected: OnDisconnected
  onReconnect: OnReconnect
  onNewLogin: OnNewLogin
}): ZapoSocket => {
  const { dataStore, sessionStore } = store
  const status: Status = { attempt: time }
  const client = new WaClient(
    {
      store: getStoreZapo(),
      sessionId: phone,
      deviceBrowser: CONFIG_SESSION_PHONE_NAME.toLowerCase(),
      deviceOsDisplayName: CONFIG_SESSION_PHONE_CLIENT,
      version: config.whatsappVersion?.join('.'),
      proxy: buildProxy(config.proxyUrl),
      history: {
        enabled: !config.ignoreHistoryMessages,
        requireFullSync: !config.ignoreHistoryMessages,
      },
      media: { processor: mediaProcessor },
      messageRetryDelayMs: config.retryRequestDelayMs,
      markOnlineOnConnect: true,
    },
    zapoLogger.child({ phone }),
  )

  let connectingTimeout: NodeJS.Timeout | undefined
  let closingByUnoapi = false
  let pairingCodeRequested = false
  let reconnecting = false

  const clearConnectingTimeout = () => {
    if (connectingTimeout) {
      clearTimeout(connectingTimeout)
      connectingTimeout = undefined
    }
  }

  const validateStatus = async () => {
    if (await sessionStore.isStatusConnecting(phone)) {
      throw new SendError(5, t('connecting_session'))
    }
    if (await sessionStore.isStatusDisconnect(phone)) {
      throw new SendError(3, t('disconnected_session'))
    }
    if (await sessionStore.isStatusOffline(phone)) {
      throw new SendError(12, t('offline_session'))
    }
    if (await sessionStore.isStatusStandBy(phone)) {
      throw new SendError(14, t('standby', MAX_CONNECT_RETRY, MAX_CONNECT_TIME))
    }
    if (!client.getState().connected) {
      throw new SendError(12, t('offline_session'))
    }
  }

  const close = async () => {
    closingByUnoapi = true
    clearConnectingTimeout()
    try {
      await client.disconnect()
    } finally {
      if (!(await sessionStore.isStatusRestartRequired(phone))) {
        await sessionStore.setStatus(phone, 'offline')
      }
    }
  }

  const logout = async () => {
    closingByUnoapi = true
    clearConnectingTimeout()
    try {
      await logoutOrDisconnectZapo(client)
    } finally {
      await dataStore.cleanSession(CLEAN_CONFIG_ON_DISCONNECT)
      await sessionStore.setStatus(phone, 'disconnected')
    }
  }

  const reconnect = async () => {
    if (reconnecting || closingByUnoapi) {
      return
    }
    reconnecting = true
    try {
      if (status.attempt > attempts) {
        await onNotification(t('attempts_exceeded', attempts), true)
        status.attempt = 1
        return
      }
      await onNotification(t('connecting_attemps', status.attempt, attempts), false)
      await sessionStore.setStatus(phone, 'offline')
      await onReconnect(status.attempt++)
    } finally {
      reconnecting = false
    }
  }

  const handleClose: WaClientEventMap['connection'] = async (event) => {
    if (event.status !== 'close') {
      return
    }
    clearConnectingTimeout()
    logger.info('Sessão Zapo %s desconectada: %s (%s)', phone, event.reason, event.code)
    if (closingByUnoapi) {
      return
    }
    if (event.isLogout) {
      status.attempt = 1
      await sessionStore.setStatus(phone, 'disconnected')
      await dataStore.cleanSession(CLEAN_CONFIG_ON_DISCONNECT)
      await onNotification(t('removed'), true)
      await onDisconnected(phone, event)
      return
    }
    if (event.reason === 'stream_error_replaced') {
      await sessionStore.setStatus(phone, 'offline')
      await onNotification(t('unique'), true)
      return
    }
    if (status.attempt === 1) {
      await onNotification(t('closed', event.code, event.reason), true)
    }
    await reconnect()
  }

  const handleQrCode = async (qr: string) => {
    if (config.connectionType !== 'qrcode') {
      return
    }
    if (status.attempt > attempts) {
      await onNotification(t('attempts_exceeded', attempts), true)
      status.attempt = 1
      await logout()
      return
    }
    await onQrCode(qr, status.attempt++, attempts)
  }

  client.on('auth_qr', ({ qr }) => {
    void handleQrCode(qr).catch((error) => logger.error(error, 'Falha ao processar o QR Code Zapo da sessão %s.', phone))
  })

  const handlePairingRequired = async () => {
    if (config.connectionType !== 'pairing_code' || pairingCodeRequested) {
      return
    }
    pairingCodeRequested = true
    try {
      const code = await client.auth.requestPairingCode(phone.replace(/[^0-9]/g, ''))
      await onNotification(t('pairing_code', code.match(/.{1,4}/g)?.join('-') || code), true)
    } catch (error) {
      pairingCodeRequested = false
      logger.error(error, 'Falha ao solicitar o código de pareamento pelo Zapo')
      await onNotification(t('error', error instanceof Error ? error.message : String(error)), true)
    }
  }

  client.on('auth_pairing_required', () => {
    void handlePairingRequired().catch((error) => logger.error(error, 'Falha ao tratar a solicitação de pareamento Zapo da sessão %s.', phone))
  })

  const handleConnection = async (event: Parameters<WaClientEventMap['connection']>[0]) => {
    if (event.status === 'close') {
      await handleClose(event)
      return
    }
    clearConnectingTimeout()
    status.attempt = 1
    closingByUnoapi = false
    const credentials = client.getCredentials()
    const connectedPhone = jidToPhoneNumber(credentials?.meJid || '', '')
    if (VALIDATE_SESSION_NUMBER && connectedPhone && connectedPhone !== phone) {
      const message = t('session_conflict', connectedPhone, phone)
      await onNotification(message, true)
      await logout()
      return
    }
    await sessionStore.setStatus(phone, 'online')
    if (event.isNewLogin) {
      await onNewLogin(phone)
    }
    await onNotification(
      t('connected', phone, credentials?.meJid || phone, config.whatsappVersion?.join('.') || 'auto', zapoVersion, new Date().toUTCString()),
      false,
    )
  }

  client.on('connection', (event) => {
    void handleConnection(event).catch((error) => logger.error(error, 'Falha ao processar a conexão Zapo da sessão %s.', phone))
  })

  const exists = async (jid: string) => {
    await validateStatus()
    if (!isIndividualJid(jid) || isGroupJid(jid)) {
      return jid
    }
    const result = (await client.profile.getLidsByPhoneNumbers([jidToPhoneNumber(jid, '')]))[0]
    if (!result?.exists) {
      return undefined
    }
    const resolvedJid = result.lidJid || result.phoneJid
    await dataStore.setJid(jidToPhoneNumber(jid, ''), resolvedJid)
    return resolvedJid
  }

  const send = async (to: string, content: WaSendMessageContent, options: ZapoSendOptions = {}) => {
    await validateStatus()
    const id = isIndividualJid(to) ? await exists(to) : phoneNumberToJid(to)
    if (!id) {
      throw new SendError(2, t('without_whatsapp', to))
    }
    if (options.composing) {
      const textualContent = content as { text?: string; caption?: string; type?: string }
      const timeToType = (textualContent.text?.length || textualContent.caption?.length || 1) * Math.floor(Math.random() * 100)
      await client.presence.subscribe(id)
      await delay(Math.floor(Math.random() * timeToType) + 100)
      await client.presence.sendChatstate(id, { state: 'composing' })
      await delay(Math.floor(Math.random() * timeToType) + 200)
      await client.presence.sendChatstate(id, { state: 'paused' })
    }
    const { broadcast, statusJidList } = options
    const sendOptions: WaSendMessageOptions = { ...options }
    delete (sendOptions as Partial<ZapoSendOptions>).composing
    delete (sendOptions as Partial<ZapoSendOptions>).broadcast
    delete (sendOptions as Partial<ZapoSendOptions>).statusJidList
    if (broadcast && statusJidList?.length) {
      return client.status.send({
        content,
        recipients: statusJidList.map((recipient) => phoneNumberToJid(recipient)),
        options: sendOptions,
      })
    }
    return client.message.send(id, content, sendOptions)
  }

  const read = async (keys: WaMessageKey[]) => {
    await validateStatus()
    await Promise.all(
      keys.map((key) =>
        client.message.sendReceipt(key.remoteJid, key.id, {
          type: 'read',
          participant: key.participant,
        }),
      ),
    )
    return true
  }

  const fetchImageUrl = async (jid: string) => {
    await validateStatus()
    return (await client.profile.getProfilePicture(jid)).url || undefined
  }

  const fetchGroupMetadata = async (jid: string) => {
    await validateStatus()
    return client.group.queryGroupMetadata(jid)
  }

  const start = async () => {
    await sessionStore.syncConnection(phone)
    if (await sessionStore.isStatusConnecting(phone)) {
      logger.warn('A sessão Zapo %s já está conectando.', phone)
      return false
    }
    if (await sessionStore.isStatusOnline(phone)) {
      logger.warn('A sessão Zapo %s já está conectada.', phone)
      return false
    }
    if (await sessionStore.verifyStatusStandBy(phone)) {
      logger.warn('A sessão Zapo %s está em espera.', phone)
      return false
    }

    closingByUnoapi = false
    await sessionStore.setStatus(phone, 'connecting')
    await onNotification(t('connecting'), false)
    connectingTimeout = setTimeout(() => {
      void (async () => {
        if (await sessionStore.isStatusConnecting(phone)) {
          const message = t('connection_timed_out', phone, CONNECTING_TIMEOUT_MS)
          await onNotification(message, false)
          logger.warn(message)
          await onDisconnected(phone, {})
        }
        await sessionStore.syncConnection(phone)
      })().catch((error) => logger.error(error, 'Falha ao tratar o tempo limite da sessão Zapo %s.', phone))
    }, CONNECTING_TIMEOUT_MS)

    void client
      .connect()
      .catch(async (error) => {
        logger.error(error, 'Falha ao conectar a sessão Zapo %s', phone)
        if (!closingByUnoapi) {
          await sessionStore.setStatus(phone, 'offline')
          await onNotification(t('error', error instanceof Error ? error.message : String(error)), true)
          await reconnect()
        }
      })
      .catch((error) => logger.error(error, 'Falha ao recuperar a conexão Zapo da sessão %s.', phone))
    return true
  }

  if (config.autoRestartMs) {
    setInterval(() => {
      void reconnect().catch((error) => logger.error(error, 'Falha ao reiniciar automaticamente a sessão Zapo %s.', phone))
    }, config.autoRestartMs)
  }

  return {
    client,
    status,
    start,
    close,
    logout,
    send,
    read,
    exists,
    fetchImageUrl,
    fetchGroupMetadata,
  }
}
