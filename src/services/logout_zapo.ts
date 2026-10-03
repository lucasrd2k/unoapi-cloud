import { Listener } from './listener'
import { configs, getConfig } from './config'
import { clients, getClient } from './client'
import { OnNewLogin } from './socket'
import { Logout } from './logout'
import logger from './logger'
import { stores } from './store'
import { dataStores } from './data_store'
import { mediaStores } from './media_store'

export class LogoutZapo implements Logout {
  constructor(
    private getClient: getClient,
    private getConfig: getConfig,
    private listener: Listener,
    private onNewLogin: OnNewLogin,
  ) {}

  async run(phone: string) {
    logger.debug('Executando logout Zapo para %s.', phone)
    const config = await this.getConfig(phone)
    const store = await config.getStore(phone, config)
    const { sessionStore, dataStore } = store
    if (await sessionStore.isStatusOnline(phone)) {
      const client = await this.getClient({
        phone,
        listener: this.listener,
        getConfig: this.getConfig,
        onNewLogin: this.onNewLogin,
      })
      await client?.logout()
    }
    await dataStore.cleanSession(true)
    clients.delete(phone)
    stores.delete(phone)
    dataStores.delete(phone)
    mediaStores.delete(phone)
    configs.delete(phone)
    await sessionStore.setStatus(phone, 'disconnected')
  }
}
