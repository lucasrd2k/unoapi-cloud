import QRCode from 'qrcode'
import { FakeWaServer, parsePairingQrString } from '@zapo-js/fake-server'
import { createNoopLogger, createStore, WaClient, type WaClientEventMap } from 'zapo-js'

jest.setTimeout(60_000)

describe('QR Code do Zapo', () => {
  test('gera um QR Code real contra o servidor falso, sem acessar o WhatsApp', async () => {
    const server = await FakeWaServer.start()
    const client = new WaClient(
      {
        store: createStore({}),
        sessionId: 'unoapi-zapo-qrcode-test',
        chatSocketUrls: [server.url],
        testHooks: { noiseRootCa: server.noiseRootCa },
        proxy: {
          mediaUpload: server.mediaProxyAgent,
          mediaDownload: server.mediaProxyAgent,
        },
      },
      createNoopLogger(),
    )

    const qrPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('O Zapo não gerou o QR Code no tempo esperado.')), 30_000)
      client.once('auth_qr', (event: Parameters<WaClientEventMap['auth_qr']>[0]) => {
        clearTimeout(timer)
        resolve(event.qr)
      })
    })
    const materialPromise = qrPromise.then((qr) => {
      const parsed = parsePairingQrString(qr)
      return {
        advSecretKey: parsed.advSecretKey,
        identityPublicKey: parsed.identityPublicKey,
      }
    })

    try {
      await client.connect()
      const pipeline = await server.waitForAuthenticatedPipeline()
      await server.runPairing(
        pipeline,
        { deviceJid: '5511999999999:1@s.whatsapp.net' },
        () => materialPromise,
      )
      const qr = await qrPromise
      const dataUrl = await QRCode.toDataURL(qr)
      expect(qr.split(',')).toHaveLength(5)
      expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    } finally {
      await client.disconnect().catch(() => undefined)
      await server.stop()
    }
  })
})
