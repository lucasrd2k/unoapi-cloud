import type { GroupMetadata, WAMessage } from 'baileys'
import { isJidGroup, isLidUser } from 'baileys'
import fetch, { Response as FetchResponse } from 'node-fetch'
import QRCode from 'qrcode'
import { delay, type WaIncomingCallEvent, type WaMessageKey, type WaSendMessageContent } from 'zapo-js'
import { Client, Contact, clients, getClient } from './client'
import { ClientForward } from './client_forward'
import { Config, configs, defaultConfig, getConfig, getMessageMetadataDefault } from './config'
import { Listener } from './listener'
import { Store } from './store'
import { createSocketZapo, type ZapoSocket } from './socket_zapo'
import { waitForZapoSessionCleanup } from './store_zapo'
import { OnNewLogin, OnNotification, OnQrCode, OnReconnect } from './socket'
import { fromZapoAddon, fromZapoIncomingMessage, fromZapoReceipt, toZapoMessageContent } from './transformer_zapo'
import { getMessageType, jidToPhoneNumber, phoneNumberToJid, TYPE_MESSAGES_MEDIA, TYPE_MESSAGES_TO_READ } from './transformer'
import { Response } from './response'
import { Template } from './template'
import { SendError } from './send_error'
import logger from './logger'
import { generateUnoId, isUnoId } from '../utils/id'
import { t } from '../i18n'
import { CONVERT_AUDIO_MESSAGE_TO_OGG, FETCH_TIMEOUT_MS, VALIDATE_MEDIA_LINK_BEFORE_SEND } from '../defaults'
import audioConverter from '../utils/audio_converter'

const attempts = 3

interface MessageDelay {
  (phone: string, to: string): Promise<void>
}

type MessageWithMetadata = {
  key?: {
    remoteJid: string
    participant?: string
  }
  groupMetadata?: GroupMetadata & { profilePicture?: string }
  profilePicture?: string
}

const delays: Map<string, Map<string, MessageDelay>> = new Map()
const sendError = new SendError(15, t('reloaded_session'))
const creatingClients = new Map<string, Promise<Client>>()

export const getClientZapo: getClient = async ({ phone, listener, getConfig, onNewLogin }) => {
  await waitForZapoSessionCleanup(phone)
  const currentClient = clients.get(phone)
  if (currentClient) {
    return currentClient
  }
  const creatingClient = creatingClients.get(phone)
  if (creatingClient) {
    logger.debug('Aguardando a criação do cliente Zapo para %s.', phone)
    return creatingClient
  }

  const createClient = async () => {
    logger.info('Criando cliente Zapo para %s.', phone)
    const config = await getConfig(phone)
    const clientCreatedByAnotherRequest = clients.get(phone)
    if (clientCreatedByAnotherRequest) {
      return clientCreatedByAnotherRequest
    }
    const client: Client =
      config.connectionType === 'forward' || config.provider === 'forwarder'
        ? new ClientForward(phone, getConfig, listener)
        : new ClientZapo(phone, listener, getConfig, onNewLogin)

    if (config.autoConnect) {
      if (await client.connect(1)) {
        clients.set(phone, client)
      }
    } else {
      clients.set(phone, client)
    }
    return client
  }

  const promise = createClient()
  creatingClients.set(phone, promise)
  try {
    return await promise
  } finally {
    if (creatingClients.get(phone) === promise) {
      creatingClients.delete(phone)
    }
  }
}

export class ClientZapo implements Client {
  private phone: string
  private listener: Listener
  private getConfig: getConfig
  private onNewLogin: OnNewLogin
  private config: Config = defaultConfig
  private store: Store | undefined
  private socket: ZapoSocket | undefined
  private calls = new Map<string, Map<string, boolean>>()

  constructor(phone: string, listener: Listener, getConfig: getConfig, onNewLogin: OnNewLogin) {
    this.phone = phone
    this.listener = listener
    this.getConfig = getConfig
    this.onNewLogin = onNewLogin
  }

  private sendUnavailable = async () => {
    const sessionStore = this.phone && (await (await this.config.getStore(this.phone, this.config)).sessionStore)
    if (sessionStore) {
      if (!(await sessionStore.isStatusConnecting(this.phone))) {
        clients.delete(this.phone)
      }
      if (await sessionStore.isStatusOnline(this.phone)) {
        await sessionStore.setStatus(this.phone, 'offline')
        clients.delete(this.phone)
      }
    }
    throw sendError
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onWebhookError = async (error: any) => {
    const { sessionStore } = this.store!
    if (!this.config.throwWebhookError && error.name === 'FetchError' && (await sessionStore.isStatusOnline(this.phone))) {
      const content: WaSendMessageContent = {
        type: 'text',
        text: `Erro ao enviar a mensagem para o webhook: ${error.message}`,
      }
      return this.socket?.send(phoneNumberToJid(this.phone), content, {})
    }
    if (this.config.throwWebhookError) {
      throw error
    }
  }

  private onNotification: OnNotification = async (text: string, important) => {
    if (!this.config.sendConnectionStatus && !important) {
      return
    }
    const payload = {
      key: {
        fromMe: true,
        remoteJid: phoneNumberToJid(this.phone),
        id: generateUnoId('NOT'),
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: text },
    }
    if (this.config.sessionWebhook) {
      try {
        const { sessionStore } = this.store!
        const body = JSON.stringify({ info: { phone: this.phone }, status: await sessionStore.getStatus(this.phone), ...payload })
        await fetch(this.config.sessionWebhook, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        logger.error(error, 'Erro ao enviar o status da sessão Zapo.')
        await this.onWebhookError(error)
      }
    } else {
      await this.listener.process(this.phone, [payload], 'status')
    }
  }

  private onQrCode: OnQrCode = async (qrCode: string, time, limit) => {
    const qrCodeUrl = await QRCode.toDataURL(qrCode)
    const message: WAMessage = {
      key: {
        fromMe: true,
        remoteJid: phoneNumberToJid(this.phone),
        id: generateUnoId('QR'),
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: {
        imageMessage: {
          url: qrCodeUrl,
          mimetype: 'image/png',
          fileLength: qrCode.length,
          caption: t('qrcode_attemps', time, limit),
        },
      },
    }
    if (this.config.sessionWebhook) {
      try {
        const { sessionStore } = this.store!
        const body = JSON.stringify({ info: { phone: this.phone }, status: await sessionStore.getStatus(this.phone), ...message })
        await fetch(this.config.sessionWebhook, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        logger.error(error, 'Erro ao enviar o QR Code da sessão Zapo.')
        await this.onWebhookError(error)
      }
    } else {
      await this.listener.process(this.phone, [message], 'qrcode')
    }
  }

  private onReconnect: OnReconnect = async (time: number) => {
    await this.disconnect(false)
    await delay(this.config.retryRequestDelayMs)
    await this.connect(time)
  }

  private delayBeforeSecondMessage: MessageDelay = async (phone, to) => {
    const waitMs = 2000
    delays.get(phone)?.set(to, this.continueAfterSecondMessage)
    await delay(waitMs)
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
  private continueAfterSecondMessage: MessageDelay = async (_phone, _to) => {}

  async connect(time: number) {
    if (this.socket) {
      logger.debug('Reutilizando o ciclo de conexão Zapo existente para %s.', this.phone)
      return true
    }
    logger.debug('Conectando o cliente Zapo para %s.', this.phone)
    this.config = await this.getConfig(this.phone)
    this.store = await this.config.getStore(this.phone, this.config)

    this.socket = createSocketZapo({
      phone: this.phone,
      store: this.store,
      config: this.config,
      attempts,
      time,
      onQrCode: this.onQrCode,
      onNotification: this.onNotification,
      onNewLogin: this.onNewLogin,
      onDisconnected: async () => this.disconnect(false),
      onReconnect: this.onReconnect,
    })
    this.subscribe()
    this.config.getMessageMetadata = async <T>(data: T) => this.getMessageMetadata(data)
    const started = await this.socket.start()
    if (!started) {
      this.socket.client.removeAllListeners()
      this.socket = undefined
      this.store = undefined
      return
    }
    logger.debug('Cliente Zapo iniciado para %s.', this.phone)
    return true
  }

  async disconnect(closeSocket = true) {
    const socket = this.socket
    this.socket = undefined
    if (socket) {
      socket.client.removeAllListeners()
      if (closeSocket) {
        await socket.close()
      }
    }
    this.store = undefined
    clients.delete(this.phone)
    configs.delete(this.phone)
    this.config.getMessageMetadata = getMessageMetadataDefault
    this.config = defaultConfig
  }

  private subscribe() {
    const socket = this.socket!
    socket.client.on('message', (event) => {
      void (async () => {
        const message = fromZapoIncomingMessage(event)
        await this.listener.process(this.phone, [message], event.offline ? 'history' : 'notify')
        const messageType = getMessageType(message)
        if (this.config.readOnReceipt && !event.key.fromMe && messageType && TYPE_MESSAGES_TO_READ.includes(messageType)) {
          await socket.read([event.key])
        }
      })().catch((error) => logger.error(error, 'Falha ao processar uma mensagem Zapo da sessão %s.', this.phone))
    })

    socket.client.on('receipt', (event) => {
      void (async () => {
        const updates = fromZapoReceipt(event)
        if (updates.length) {
          await this.listener.process(this.phone, updates, 'update')
        }
      })().catch((error) => logger.error(error, 'Falha ao processar uma confirmação Zapo da sessão %s.', this.phone))
    })

    socket.client.on('message_addon', (event) => {
      void (async () => {
        const message = fromZapoAddon(event)
        if (message) {
          await this.listener.process(this.phone, [message], 'notify')
        }
      })().catch((error) => logger.error(error, 'Falha ao processar um complemento de mensagem Zapo da sessão %s.', this.phone))
    })

    socket.client.on('call', (event) => {
      void this.processCall(event).catch((error) => logger.error(error, 'Falha ao processar uma chamada Zapo da sessão %s.', this.phone))
    })
  }

  private async processCall(event: WaIncomingCallEvent) {
    if (event.type !== 'offer') {
      return
    }
    const from = event.callerPnJid || event.callCreatorJid || event.chatJid
    if (!from || this.calls.get(this.phone)?.get(from)) {
      return
    }
    if (!this.calls.has(this.phone)) {
      this.calls.set(this.phone, new Map<string, boolean>())
    }
    this.calls.get(this.phone)?.set(from, true)

    if (this.config.rejectCalls) {
      logger.warn('O Zapo não expõe rejeição ativa de chamadas; enviando apenas a mensagem automática para %s.', from)
      await this.socket?.send(from, { type: 'text', text: this.config.rejectCalls }, {})
    }

    const messageCallsWebhook = this.config.rejectCallsWebhook || this.config.messageCallsWebhook
    if (messageCallsWebhook) {
      await this.listener.process(
        this.phone,
        [
          {
            key: { fromMe: false, id: generateUnoId('CALL'), remoteJid: from },
            message: { conversation: messageCallsWebhook },
          },
        ],
        'notify',
      )
    }
    setTimeout(() => this.calls.get(this.phone)?.delete(from), 10_000)
  }

  async logout() {
    const socket = this.socket
    if (socket) {
      socket.client.removeAllListeners('message')
      socket.client.removeAllListeners('receipt')
      socket.client.removeAllListeners('message_addon')
      socket.client.removeAllListeners('call')
      await socket.logout()
    }
    await this.disconnect(false)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(payload: any, options: any = {}) {
    const { status, type, to } = payload
    try {
      if (status) {
        return this.updateStatus(payload)
      }
      if (!['text', 'image', 'audio', 'sticker', 'document', 'video', 'template', 'interactive', 'contacts', 'reaction'].includes(type)) {
        throw new Error(`Tipo de mensagem desconhecido: ${type}`)
      }
      if (!this.socket) {
        return this.sendUnavailable()
      }

      if (VALIDATE_MEDIA_LINK_BEFORE_SEND && TYPE_MESSAGES_MEDIA.includes(type)) {
        const link = payload[type]?.link
        if (link) {
          const response: FetchResponse = await fetch(link, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            method: 'HEAD',
          })
          if (!response.ok) {
            throw new SendError(11, t('invalid_link', response.status, link))
          }
        }
      }

      let content: WaSendMessageContent
      if (type === 'template') {
        const bound = await new Template(this.getConfig).bind(this.phone, payload.template.name, payload.template.components)
        content = { type: 'text', text: bound.text }
      } else if (CONVERT_AUDIO_MESSAGE_TO_OGG && type === 'audio') {
        const link = payload.audio?.link
        const { buffer, waveform } = await audioConverter(link)
        content = {
          type: 'audio',
          media: buffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
          waveform,
        }
      } else {
        content = await toZapoMessageContent(payload, this.config.customMessageCharactersFunction)
      }

      const sendOptions = { ...options, composing: this.config.composingMessage }
      const messageId = payload?.context?.message_id || payload?.context?.id
      if (messageId) {
        const key = (await this.store?.dataStore?.loadKey(messageId)) as (WaMessageKey & { originalId?: string }) | undefined
        if (key?.id) {
          sendOptions.quote = {
            remoteJid: key.remoteJid || phoneNumberToJid(to),
            id: key.originalId || key.id,
            fromMe: !!key.fromMe,
            participant: key.participant,
          }
        }
      }
      if (payload?.ttl !== undefined) {
        sendOptions.expirationSeconds = payload.ttl
      }

      const phoneDelays = delays.get(this.phone) || new Map<string, MessageDelay>()
      delays.set(this.phone, phoneDelays)
      const wait = phoneDelays.get(to) || (async (_phone: string, target: string) => phoneDelays.set(target, this.delayBeforeSecondMessage))
      await wait(this.phone, to)

      const result = (await this.socket.send(to, content, sendOptions)) as { id?: string }
      if (!result?.id) {
        throw new Error('O Zapo não retornou o identificador da mensagem enviada.')
      }
      const key = {
        id: result.id,
        remoteJid: phoneNumberToJid(to),
        fromMe: true,
      }
      await this.store?.dataStore?.setKey(result.id, key)
      return {
        ok: {
          messaging_product: 'whatsapp',
          contacts: [{ wa_id: jidToPhoneNumber(to, '') }],
          messages: [{ id: result.id }],
        },
      } as Response
    } catch (error) {
      return this.handleSendError(error, payload, to)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async updateStatus(payload: any): Promise<Response> {
    const status = payload.status
    if (!['sent', 'delivered', 'failed', 'progress', 'read', 'deleted'].includes(status)) {
      throw new Error(`Status de mensagem desconhecido: ${status}`)
    }
    if (status === 'read') {
      const currentStatus = await this.store?.dataStore?.loadStatus(payload.message_id)
      if (currentStatus !== status) {
        const key = (await this.store?.dataStore?.loadKey(payload.message_id)) as WaMessageKey | undefined
        if (key?.id && !isUnoId(key.id)) {
          await this.socket?.read([key])
          await this.store?.dataStore?.setStatus(payload.message_id, status)
        }
      }
    } else if (status === 'deleted') {
      const key = (await this.store?.dataStore?.loadKey(payload.message_id)) as WaMessageKey | undefined
      if (key?.id && !isUnoId(key.id)) {
        await this.socket?.send(key.remoteJid, { type: 'revoke', target: key }, {})
        await this.store?.dataStore?.setStatus(payload.message_id, status)
      }
    } else {
      await this.store?.dataStore?.setStatus(payload.message_id, status)
    }
    return { ok: { success: true } }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleSendError(error: any, payload: any, to: string): Promise<Response> {
    if (!(error instanceof SendError)) {
      throw error
    }
    await this.onNotification(error.title, true)
    if ([3, '3', 12, '12'].includes(error.code)) {
      await this.socket?.close()
      await this.connect(1)
    }
    const id = generateUnoId('WARN')
    const ok = {
      messaging_product: 'whatsapp',
      contacts: [{ wa_id: jidToPhoneNumber(to, '') }],
      messages: [{ id }],
    }
    const errorPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: this.phone,
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: this.phone.replace('+', ''),
                  phone_number_id: this.phone.replace('+', ''),
                },
                statuses: [
                  {
                    id,
                    recipient_id: jidToPhoneNumber(to || this.phone, ''),
                    status: 'failed',
                    timestamp: Math.floor(Date.now() / 1000),
                    errors: [{ code: error.code, title: error.title }],
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    }
    return { ok, error: errorPayload }
  }

  async getMessageMetadata<T>(message: T) {
    const data = message as T & MessageWithMetadata
    const key = data?.key
    if (!key) {
      return message
    }
    let remoteJid: string | undefined
    if (this.config.groupMessagesCloudFormat && isJidGroup(key.remoteJid)) {
      remoteJid = key.participant
    } else if (isJidGroup(key.remoteJid)) {
      let groupMetadata: GroupMetadata | undefined
      try {
        groupMetadata = (await this.socket?.fetchGroupMetadata(key.remoteJid)) as GroupMetadata | undefined
      } catch (error) {
        logger.warn(error, 'Não foi possível obter os metadados do grupo pelo Zapo.')
      }
      data.groupMetadata =
        groupMetadata ||
        ({
          addressingMode: isLidUser(key.remoteJid) ? 'lid' : 'pn',
          id: key.remoteJid,
          owner: '',
          subject: key.remoteJid,
          participants: [],
        } as GroupMetadata)
      if (this.config.sendProfilePicture) {
        try {
          data.groupMetadata.profilePicture = await this.socket?.fetchImageUrl(key.remoteJid)
        } catch (error) {
          logger.warn(error, 'Não foi possível obter a imagem do grupo pelo Zapo.')
        }
      }
      remoteJid = key.participant
    } else {
      remoteJid = key.remoteJid
    }

    if (remoteJid && this.config.sendProfilePicture) {
      try {
        const resolvedJid = await this.socket?.exists(remoteJid)
        if (resolvedJid) {
          data.profilePicture = await this.socket?.fetchImageUrl(resolvedJid)
        }
      } catch (error) {
        logger.warn(error, 'Não foi possível obter a imagem do contato pelo Zapo.')
      }
    }
    return data as T
  }

  async contacts(numbers: string[]) {
    const contacts: Contact[] = []
    for (const number of numbers) {
      const realJid = await this.socket?.exists(jidToPhoneNumber(number, ''))
      contacts.push({
        wa_id: realJid,
        input: number,
        status: realJid ? 'valid' : 'invalid',
      })
    }
    return contacts
  }
}
