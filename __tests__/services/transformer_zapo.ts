import { fromZapoAddon, fromZapoIncomingMessage, fromZapoReceipt } from '../../src/services/transformer_zapo'
import type { WaIncomingAddonEvent, WaIncomingMessageEvent, WaIncomingReceiptEvent } from 'zapo-js'

describe('transformador Zapo', () => {
  test('normaliza uma mensagem recebida para o contrato da UnoAPI', () => {
    const event = {
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        id: 'MSG-1',
        fromMe: false,
        isGroup: false,
        isBroadcast: false,
        isNewsletter: false,
        senderDevice: 0,
      },
      timestampSeconds: 1_700_000_000,
      pushName: 'Contato de teste',
      message: { conversation: 'Olá' },
      rawNode: { tag: 'message', attrs: {} },
    } as unknown as WaIncomingMessageEvent

    const message = fromZapoIncomingMessage(event)

    expect(message.key).toEqual(event.key)
    expect(message.message).toEqual(event.message)
    expect(message._provider).toBe('zapo')
    expect(message._zapoEvent).toBe(event)
    expect(Object.keys(message)).not.toContain('_zapoEvent')
  })

  test('converte recibos Zapo para atualizações compreendidas pela UnoAPI', () => {
    const updates = fromZapoReceipt({
      chatJid: '5511999999999@s.whatsapp.net',
      stanzaId: 'MSG-1',
      rawNode: { tag: 'receipt', attrs: {} },
      status: 'read',
      fromSelfDevice: false,
      messageIds: ['MSG-1', 'MSG-2'],
    } as unknown as WaIncomingReceiptEvent)

    expect(updates).toHaveLength(2)
    expect(updates[0].update.status).toBe(4)
    expect(updates[1].key.id).toBe('MSG-2')
  })

  test('converte uma reação descriptografada pelo Zapo', () => {
    const message = fromZapoAddon({
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        id: 'REACTION-1',
        fromMe: false,
        isGroup: false,
        isBroadcast: false,
        isNewsletter: false,
        senderDevice: 0,
      },
      kind: 'reaction',
      targetMessageId: 'MSG-1',
      decrypted: {
        kind: 'reaction',
        reaction: { text: '👍', senderTimestampMs: 1_700_000_000_000 },
      },
      raw: {},
      rawNode: { tag: 'message', attrs: {} },
    } as unknown as WaIncomingAddonEvent)

    expect(message?.message?.reactionMessage?.text).toBe('👍')
    expect(message?.message?.reactionMessage?.key?.id).toBe('MSG-1')
  })
})
