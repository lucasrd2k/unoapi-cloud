import { UNOAPI_SERVER_NAME } from '../defaults'
import { clients, getClient } from './client'
import { getConfig } from './config'
import { Listener } from './listener'
import { OnNewLogin } from './socket'
import logger from './logger'
import { Reload } from './reload'

export class ReloadZapo extends Reload {
  constructor(
    private getClient: getClient,
    private getConfig: getConfig,
    private listener: Listener,
    private onNewLogin: OnNewLogin,
  ) {
    super()
  }

  async run(phone: string) {
    const config = await this.getConfig(phone)
    if (config.server !== UNOAPI_SERVER_NAME) {
      return super.run(phone)
    }
    const currentClient = clients.get(phone)
    const { sessionStore } = await config.getStore(phone, config)
    if (currentClient) {
      logger.debug('Desconectando o cliente Zapo atual antes de recarregar a sessão %s.', phone)
      await currentClient?.disconnect()
    }
    await super.run(phone)
    await sessionStore.setStatus(phone, 'online')
    await sessionStore.setStatus(phone, 'disconnected')
    await this.getClient({
      phone,
      listener: this.listener,
      getConfig: this.getConfig,
      onNewLogin: this.onNewLogin,
    })
    logger.info('Sessão Zapo %s recarregada.', phone)
  }
}
