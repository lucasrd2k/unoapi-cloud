import logger from './logger'
import { Client, getClient } from './client'
import { getConfig } from './config'
import { OnNewLogin } from './socket'
import { Listener } from './listener'
import { Sync } from './sync'
import { t } from '../i18n'
import { SEND_MESSAGE_ON_DECRYPT_ERROR } from '../defaults'

export class SyncZapo implements Sync {
  constructor(
    private service: Listener,
    private getConfig: getConfig,
    private getClient: getClient,
    private onNewLogin: OnNewLogin,
  ) {}

  async process(phone: string, jids: string[]) {
    if (!SEND_MESSAGE_ON_DECRYPT_ERROR) {
      return true
    }
    const client: Client = await this.getClient({
      phone,
      listener: this.service,
      getConfig: this.getConfig,
      onNewLogin: this.onNewLogin,
    })
    if (!client) {
      throw new Error(`O cliente Zapo da sessão ${phone} está desconectado.`)
    }
    logger.debug('Enviando mensagem automática pelo Zapo para sincronizar as chaves de %s.', phone)
    await Promise.all(
      jids.map((jid) =>
        client.send(
          {
            type: 'text',
            to: jid,
            text: { body: t('retry_decrypt') },
          },
          {},
        ),
      ),
    )
    return true
  }
}
