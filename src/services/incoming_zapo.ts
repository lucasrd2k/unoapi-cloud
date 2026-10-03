import { Incoming } from './incoming'
import { Client, getClient } from './client'
import { getConfig } from './config'
import { OnNewLogin } from './socket'
import logger from './logger'
import { Listener } from './listener'

export class IncomingZapo implements Incoming {
  private service: Listener
  private getClient: getClient
  private getConfig: getConfig
  private onNewLogin: OnNewLogin

  constructor(service: Listener, getConfig: getConfig, getClient: getClient, onNewLogin: OnNewLogin) {
    this.service = service
    this.getConfig = getConfig
    this.getClient = getClient
    this.onNewLogin = onNewLogin
  }

  public async send(phone: string, payload: object, options: object) {
    const client: Client = await this.getClient({
      phone,
      listener: this.service,
      getConfig: this.getConfig,
      onNewLogin: this.onNewLogin,
    })
    if (!client) {
      throw new Error(`O cliente Zapo da sessão ${phone} está desconectado.`)
    }
    const to = payload['to'] || ''
    if (to.endsWith('@broadcast')) {
      options['broadcast'] = true
      const config = await this.getConfig(phone)
      const { dataStore } = await config.getStore(phone, config)
      options['statusJidList'] = await dataStore.getAllJid()
    }
    logger.debug('Enviando pelo Zapo com as opções %s.', JSON.stringify(options))
    const response = await client.send(payload, options)
    if (to) {
      const config = await this.getConfig(phone)
      const { dataStore } = await config.getStore(phone, config)
      await dataStore.setLastMessageDirection(to, 'incoming')
    }
    return response
  }
}
