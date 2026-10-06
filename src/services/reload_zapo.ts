import { UNOAPI_SERVER_NAME } from '../defaults'
import { clients, getClient } from './client'
import { getConfig } from './config'
import { Listener } from './listener'
import { OnNewLogin } from './socket'
import logger from './logger'
import { Reload } from './reload'

const reloads = new Map<string, Promise<void>>()

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
    const currentReload = reloads.get(phone)
    if (currentReload) {
      logger.debug('Aguardando a recarga Zapo já iniciada para a sessão %s.', phone)
      return currentReload
    }

    const reload = this.reload(phone)
    reloads.set(phone, reload)
    try {
      await reload
    } finally {
      if (reloads.get(phone) === reload) {
        reloads.delete(phone)
      }
    }
  }

  private async reload(phone: string) {
    const config = await this.getConfig(phone)
    if (config.server !== UNOAPI_SERVER_NAME) {
      return super.run(phone)
    }
    const currentClient = clients.get(phone)
    const { sessionStore } = await config.getStore(phone, config)
    const currentStatus = await sessionStore.getStatus(phone)
    if (currentStatus === 'online' || currentStatus === 'connecting') {
      logger.info('Recarga Zapo ignorada para a sessão %s porque ela está %s.', phone, currentStatus)
      return
    }
    if (currentClient) {
      logger.debug('Desconectando o cliente Zapo atual antes de recarregar a sessão %s.', phone)
      await currentClient?.disconnect()
    }
    await super.run(phone)
    await this.getClient({
      phone,
      listener: this.listener,
      getConfig: this.getConfig,
      onNewLogin: this.onNewLogin,
    })
    logger.info('Sessão Zapo %s recarregada.', phone)
  }
}
