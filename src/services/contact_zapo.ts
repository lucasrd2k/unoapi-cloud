import { Contact } from './contact'
import { Client, getClient } from './client'
import { getConfig } from './config'
import { OnNewLogin } from './socket'
import { Listener } from './listener'
import logger from './logger'

export default class ContactZapo implements Contact {
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

  public async verify(phone: string, numbers: string[], webhook: string | undefined) {
    const client: Client = await this.getClient({
      phone,
      listener: this.service,
      getConfig: this.getConfig,
      onNewLogin: this.onNewLogin,
    })
    if (!client) {
      throw new Error(`O cliente Zapo da sessão ${phone} está desconectado.`)
    }
    const contacts = await client.contacts(numbers)
    if (webhook) {
      const body = JSON.stringify({ contacts })
      let response: Response
      try {
        response = await fetch(webhook, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        })
      } catch (error) {
        logger.error(error, 'Erro ao enviar os contatos para %s.', webhook)
        throw error
      }
      if (!response.ok) {
        throw new Error(await response.text())
      }
    }
    return { contacts }
  }
}
