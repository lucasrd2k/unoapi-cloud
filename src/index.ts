
import logger from './services/logger'
import { App } from './app'
import { IncomingBaileys } from './services/incoming_baileys'
import { Incoming } from './services/incoming'
import { Outgoing } from './services/outgoing'
import { OutgoingCloudApi } from './services/outgoing_cloud_api'
import { SessionStoreFile } from './services/session_store_file'
import { SessionStore } from './services/session_store'
import { autoConnect } from './services/auto_connect'
import { getConfigByEnv } from './services/config_by_env'
import { getClientBaileys } from './services/client_baileys'
import { onNewLoginAlert } from './services/on_new_login_alert'
import { Broadcast } from './services/broadcast'
import { isInBlacklistInMemory, addToBlacklistInMemory, addToBlacklistRedis } from './services/blacklist'
import { version } from '../package.json'
import { Listener } from './services/listener'
import { ListenerBaileys } from './services/listener_baileys'
import { ReloadBaileys } from './services/reload_baileys'
import { LogoutBaileys } from './services/logout_baileys'
import * as Sentry from '@sentry/node'
import { BASE_URL, PORT } from './defaults'
import { SyncDummy } from './services/sync_dummy'
import { getClientZapo } from './services/client_zapo'
import { IncomingZapo } from './services/incoming_zapo'
import { ListenerZapo } from './services/listener_zapo'
import { ReloadZapo } from './services/reload_zapo'
import { LogoutZapo } from './services/logout_zapo'
import {
  IncomingWhatsApp,
  ListenerWhatsApp,
  LogoutWhatsApp,
  ReloadWhatsApp,
  getClientWhatsApp,
} from './services/whatsapp_provider'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: true,
  })
}

const outgoingCloudApi: Outgoing = new OutgoingCloudApi(getConfigByEnv, isInBlacklistInMemory, addToBlacklistRedis)
const broadcast: Broadcast = new Broadcast()
const syncDummy = new SyncDummy()
const listenerBaileys: Listener = new ListenerBaileys(outgoingCloudApi, broadcast, getConfigByEnv, syncDummy)
const listenerZapo: Listener = new ListenerZapo(outgoingCloudApi, broadcast, getConfigByEnv, syncDummy)
const listener: Listener = new ListenerWhatsApp(listenerBaileys, listenerZapo, getConfigByEnv)
const onNewLoginn = onNewLoginAlert(listener)
const incomingBaileys: Incoming = new IncomingBaileys(listener, getConfigByEnv, getClientBaileys, onNewLoginn)
const incomingZapo: Incoming = new IncomingZapo(listener, getConfigByEnv, getClientZapo, onNewLoginn)
const incoming: Incoming = new IncomingWhatsApp(incomingBaileys, incomingZapo, getConfigByEnv)
const sessionStore: SessionStore = new SessionStoreFile()

const reloadBaileys = new ReloadBaileys(getClientBaileys, getConfigByEnv, listener, onNewLoginn)
const reloadZapo = new ReloadZapo(getClientZapo, getConfigByEnv, listener, onNewLoginn)
const reload = new ReloadWhatsApp(reloadBaileys, reloadZapo, getConfigByEnv)
const logoutBaileys = new LogoutBaileys(getClientBaileys, getConfigByEnv, listener, onNewLoginn)
const logoutZapo = new LogoutZapo(getClientZapo, getConfigByEnv, listener, onNewLoginn)
const logout = new LogoutWhatsApp(logoutBaileys, logoutZapo, getConfigByEnv)

const app: App = new App(
  incoming,
  outgoingCloudApi,
  BASE_URL,
  getConfigByEnv,
  sessionStore,
  onNewLoginn,
  addToBlacklistInMemory,
  reload,
  logout,
)
broadcast.setSever(app.socket)

app.server.listen(PORT, '0.0.0.0', async () => {
  logger.info('Unoapi Cloud version: %s, listening on port: %s', version, PORT)
  autoConnect(sessionStore, listener, getConfigByEnv, getClientWhatsApp, onNewLoginn)
})

export default app

process.on('uncaughtException', (reason: any) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason)
  }
  logger.error('uncaughtException index: %s %s', reason, reason.stack)
  process.exit(1)
})

process.on('unhandledRejection', (reason: any, promise) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason)
  }
  logger.error('unhandledRejection: %s', reason.stack)
  logger.error('promise: %s', promise)
  process.exit(1)
})
