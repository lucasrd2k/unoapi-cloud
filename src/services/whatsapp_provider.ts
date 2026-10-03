import { Client, getClient } from './client'
import { getClientBaileys } from './client_baileys'
import { getClientZapo } from './client_zapo'
import { Config, getConfig, WhatsAppProvider } from './config'
import { Contact } from './contact'
import { Incoming } from './incoming'
import { eventType, Listener } from './listener'
import { Logout } from './logout'
import { Reload } from './reload'
import { Sync } from './sync'

export const resolveWhatsAppProvider = (config: Config): WhatsAppProvider => {
  const provider = config.provider || 'baileys'
  if (!['baileys', 'zapo', 'forwarder'].includes(provider)) {
    throw new Error(`O provedor de WhatsApp "${provider}" não é suportado.`)
  }
  return provider
}

export const getClientWhatsApp: getClient = async (options): Promise<Client> => {
  const config = await options.getConfig(options.phone)
  return resolveWhatsAppProvider(config) === 'zapo' ? getClientZapo(options) : getClientBaileys(options)
}

export class ListenerWhatsApp implements Listener {
  constructor(
    private baileys: Listener,
    private zapo: Listener,
    private getConfig: getConfig,
  ) {}

  async process(phone: string, messages: object[], type: eventType) {
    const config = await this.getConfig(phone)
    const listener = resolveWhatsAppProvider(config) === 'zapo' ? this.zapo : this.baileys
    return listener.process(phone, messages, type)
  }
}

export class IncomingWhatsApp implements Incoming {
  constructor(
    private baileys: Incoming,
    private zapo: Incoming,
    private getConfig: getConfig,
  ) {}

  async send(phone: string, payload: object, options: object) {
    const config = await this.getConfig(phone)
    const incoming = resolveWhatsAppProvider(config) === 'zapo' ? this.zapo : this.baileys
    return incoming.send(phone, payload, options)
  }
}

export class ContactWhatsApp implements Contact {
  constructor(
    private baileys: Contact,
    private zapo: Contact,
    private getConfig: getConfig,
  ) {}

  async verify(phone: string, numbers: string[], webhook: string | undefined) {
    const config = await this.getConfig(phone)
    const contact = resolveWhatsAppProvider(config) === 'zapo' ? this.zapo : this.baileys
    return contact.verify(phone, numbers, webhook)
  }
}

export class LogoutWhatsApp implements Logout {
  constructor(
    private baileys: Logout,
    private zapo: Logout,
    private getConfig: getConfig,
  ) {}

  async run(phone: string) {
    const config = await this.getConfig(phone)
    return resolveWhatsAppProvider(config) === 'zapo' ? this.zapo.run(phone) : this.baileys.run(phone)
  }
}

export class ReloadWhatsApp extends Reload {
  constructor(
    private baileys: Reload,
    private zapo: Reload,
    private getConfig: getConfig,
  ) {
    super()
  }

  async run(phone: string) {
    const config = await this.getConfig(phone)
    return resolveWhatsAppProvider(config) === 'zapo' ? this.zapo.run(phone) : this.baileys.run(phone)
  }
}

export class SyncWhatsApp implements Sync {
  constructor(
    private baileys: Sync,
    private zapo: Sync,
    private getConfig: getConfig,
  ) {}

  async process(phone: string, jids: string[]) {
    const config = await this.getConfig(phone)
    return resolveWhatsAppProvider(config) === 'zapo' ? this.zapo.process(phone, jids) : this.baileys.process(phone, jids)
  }
}
