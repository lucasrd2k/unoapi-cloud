import type {
  Proto,
  WaIncomingAddonEvent,
  WaIncomingMessageEvent,
  WaIncomingReceiptEvent,
  WaMessageKey,
  WaSendMessageContent,
} from 'zapo-js'
import type { Readable } from 'node:stream'
import fetch from 'node-fetch'
import { FETCH_TIMEOUT_MS, SEND_AUDIO_MESSAGE_AS_PTT } from '../defaults'
import { getMimetype, phoneNumberToJid, toBaileysMessageContent } from './transformer'
import { SendError } from './send_error'
import { t } from '../i18n'

export type ZapoCompatibleMessage = {
  key: Record<string, unknown>
  messageTimestamp?: number
  pushName?: string
  message?: Proto.IMessage
  _provider: 'zapo'
  _zapoEvent?: WaIncomingMessageEvent
}

export const fromZapoIncomingMessage = (event: WaIncomingMessageEvent): ZapoCompatibleMessage => {
  const message: ZapoCompatibleMessage = {
    key: { ...event.key },
    messageTimestamp: event.timestampSeconds,
    pushName: event.pushName,
    message: event.message,
    _provider: 'zapo',
  }
  Object.defineProperty(message, '_zapoEvent', {
    value: event,
    enumerable: false,
  })
  return message
}

const receiptStatus = {
  delivered: 3,
  read: 4,
  played: 5,
  inactive: 2,
} as const

export const fromZapoReceipt = (event: WaIncomingReceiptEvent) =>
  event.messageIds.map((id) => ({
    key: {
      id,
      remoteJid: event.chatJid,
      participant: event.participantJid,
      fromMe: true,
    },
    update: { status: receiptStatus[event.status] },
    _provider: 'zapo',
  }))

export const fromZapoAddon = (event: WaIncomingAddonEvent): ZapoCompatibleMessage | undefined => {
  if (event.decrypted.kind !== 'reaction') {
    return undefined
  }

  const reaction = event.decrypted.reaction
  const target: WaMessageKey = {
    remoteJid: event.key.remoteJid,
    id: event.targetMessageId,
    fromMe: !event.key.fromMe,
    participant: event.key.participant,
  }

  return {
    key: { ...event.key },
    message: {
      reactionMessage: {
        ...reaction,
        key: reaction.key || target,
      },
    },
    _provider: 'zapo',
  }
}

const fetchMedia = async (link: string): Promise<Readable> => {
  const response = await fetch(link, {
    method: 'GET',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok || !response.body) {
    throw new SendError(11, t('invalid_link', response.status, link))
  }
  return response.body as unknown as Readable
}

type LegacyInteractiveContent = Proto.IMessage & {
  title?: string
  text?: string
  buttonText?: string
  footer?: string
  sections?: Proto.Message.IListMessage['sections']
  buttons?: Proto.Message.IButtonsMessage['buttons']
}

type LegacyContactsContent = {
  displayName?: string
  contacts?: Array<{ vcard?: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toZapoInteractiveContent = (payload: any): Proto.IMessage => {
  const content = toBaileysMessageContent(payload) as LegacyInteractiveContent
  if (content.interactiveMessage) {
    return { interactiveMessage: content.interactiveMessage as Proto.Message.IInteractiveMessage }
  }
  if (content.listMessage) {
    return { listMessage: content.listMessage as Proto.Message.IListMessage }
  }
  if (content.sections) {
    return {
      listMessage: {
        title: content.title,
        description: content.text,
        buttonText: content.buttonText,
        footerText: content.footer,
        sections: content.sections,
        listType: 2,
      },
    }
  }
  if (content.buttons) {
    return {
      buttonsMessage: {
        contentText: content.text,
        footerText: content.footer,
        buttons: content.buttons,
        headerType: 1,
      },
    }
  }
  return content as Proto.IMessage
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toZapoContactsContent = (payload: any): Proto.IMessage => {
  const contacts = (toBaileysMessageContent(payload) as { contacts?: LegacyContactsContent }).contacts
  const entries = contacts?.contacts || []
  if (entries.length === 1) {
    return {
      contactMessage: {
        displayName: contacts?.displayName,
        vcard: entries[0].vcard,
      },
    }
  }
  return {
    contactsArrayMessage: {
      displayName: contacts?.displayName,
      contacts: entries.map((entry) => ({
        displayName: contacts?.displayName,
        vcard: entry.vcard,
      })),
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toZapoMessageContent = async (payload: any, customMessageCharactersFunction = (message: string) => message): Promise<WaSendMessageContent> => {
  const { type } = payload
  if (type === 'text') {
    return {
      type: 'text',
      text: customMessageCharactersFunction(payload.text.body),
    }
  }

  if (['image', 'audio', 'sticker', 'document', 'video'].includes(type)) {
    const mediaPayload = payload[type] || {}
    const link = mediaPayload.link
    if (!link) {
      throw new Error(`O link da mídia do tipo ${type} não foi informado.`)
    }
    const content = {
      type,
      media: await fetchMedia(link),
      mimetype: getMimetype(payload),
      caption: mediaPayload.caption ? customMessageCharactersFunction(mediaPayload.caption) : undefined,
      fileName: mediaPayload.filename,
      ptt: type === 'audio' ? SEND_AUDIO_MESSAGE_AS_PTT : undefined,
    }
    return content as WaSendMessageContent
  }

  if (type === 'interactive') {
    return toZapoInteractiveContent(payload)
  }

  if (type === 'contacts') {
    return toZapoContactsContent(payload)
  }

  if (type === 'reaction') {
    return {
      type: 'reaction',
      emoji: payload.reaction?.emoji || '',
      target: {
        remoteJid: phoneNumberToJid(payload.to),
        id: payload.reaction?.message_id,
        fromMe: false,
      },
    }
  }

  throw new Error(`Tipo de mensagem desconhecido: ${type}`)
}
