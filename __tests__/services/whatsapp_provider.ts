import { defaultConfig } from '../../src/services/config'
import { resolveWhatsAppProvider } from '../../src/services/whatsapp_provider'

describe('seleção do provedor de WhatsApp', () => {
  test.each(['baileys', 'zapo', 'forwarder'] as const)('aceita o provedor %s', (provider) => {
    expect(resolveWhatsAppProvider({ ...defaultConfig, provider })).toBe(provider)
  })

  test('mantém Baileys como fallback interno quando o provedor não foi definido', () => {
    expect(resolveWhatsAppProvider({ ...defaultConfig, provider: undefined })).toBe('baileys')
  })
})
