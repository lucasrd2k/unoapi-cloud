import { Request, Response } from 'express'
import { getConfig } from '../services/config'
import { setConfig } from '../services/redis'
import logger from '../services/logger'
import { Logout } from '../services/logout'
import { Reload } from '../services/reload'
import { UNOAPI_SERVER_NAME } from '../defaults'

export class RegistrationController {
  private getConfig: getConfig
  private logout: Logout
  private reload: Reload

  constructor(getConfig: getConfig, reload: Reload, logout: Logout) {
    this.getConfig = getConfig
    this.reload = reload
    this.logout = logout
  }

  public async register(req: Request, res: Response) {
    logger.debug('register method %s', req.method)
    logger.debug('register params %s', JSON.stringify(req.params))
    logger.debug('register query %s', JSON.stringify(req.query))
    const { phone } = req.params
    try {
      await setConfig(phone, {
        ...req.body,
        server: req.body.server || UNOAPI_SERVER_NAME,
      })
      const config = await this.getConfig(phone)
      const { sessionStore } = await config.getStore(phone, config)
      const status = await sessionStore.getStatus(phone)
      const forceReconnect = String(req.query.force_reconnect || '').toLowerCase() === 'true'

      // /register também é usado para atualizar a configuração. Recarregar uma
      // sessão saudável só para reaplicar a mesma configuração fecha o socket e
      // pode invalidar o dispositivo vinculado. A próxima conexão já lerá a
      // configuração persistida no Redis.
      if (!forceReconnect && (status === 'online' || status === 'connecting')) {
        logger.info('Registro da sessão %s preservado porque ela está %s.', phone, status)
        return res.status(200).json({ ...config, status })
      }

      if (forceReconnect) {
        logger.info('Reconexão manual solicitada para a sessão %s.', phone)
        await sessionStore.setStatus(phone, 'offline')
      }

      await this.reload.run(phone)
      return res.status(200).json({ ...config, status: await sessionStore.getStatus(phone) })
    } catch (e) {
      return res.status(400).json({
        status: 'error',
        message: `Não foi possível criar ou atualizar a sessão ${phone}: ${e.message}`,
      })
    }
  }

  public async deregister(req: Request, res: Response) {
    logger.debug('deregister method %s', req.method)
    logger.debug('deregister headers %s', JSON.stringify(req.headers))
    logger.debug('deregister params %s', JSON.stringify(req.params))
    logger.debug('deregister body %s', JSON.stringify(req.body))
    logger.debug('deregister query %s', JSON.stringify(req.query))
    const { phone } = req.params
    await this.logout.run(phone)
    return res.status(204).send()
  }
}
