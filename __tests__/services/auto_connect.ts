import { autoConnect } from '../../src/services/auto_connect'
import { UNOAPI_SERVER_NAME } from '../../src/defaults'

describe('conexão automática por provedor', () => {
  const phone = '5562982296400'

  const createScenario = (provider: 'baileys' | 'zapo') => {
    const sessionStore = {
      getPhones: jest.fn().mockResolvedValue([phone]),
      syncConnection: jest.fn().mockResolvedValue(undefined),
      isStatusStandBy: jest.fn().mockResolvedValue(false),
      isStatusConnecting: jest.fn().mockResolvedValue(false),
      isStatusOnline: jest.fn().mockResolvedValue(false),
      setStatus: jest.fn().mockResolvedValue(undefined),
    }
    const config = {
      provider,
      server: UNOAPI_SERVER_NAME,
      getStore: jest.fn().mockResolvedValue({ sessionStore }),
    }
    const getConfig = jest.fn().mockResolvedValue(config)
    const getClient = jest.fn().mockResolvedValue({})

    return { sessionStore, getConfig, getClient }
  }

  test('não aplica a validação de credenciais do Baileys a uma sessão Zapo', async () => {
    const { sessionStore, getConfig, getClient } = createScenario('zapo')

    await autoConnect(
      sessionStore as never,
      {} as never,
      getConfig as never,
      getClient as never,
      jest.fn(),
    )

    expect(sessionStore.syncConnection).not.toHaveBeenCalled()
    expect(getClient).toHaveBeenCalledTimes(1)
  })

  test('mantém a validação de credenciais para uma sessão Baileys', async () => {
    const { sessionStore, getConfig, getClient } = createScenario('baileys')

    await autoConnect(
      sessionStore as never,
      {} as never,
      getConfig as never,
      getClient as never,
      jest.fn(),
    )

    expect(sessionStore.syncConnection).toHaveBeenCalledWith(phone)
    expect(getClient).toHaveBeenCalledTimes(1)
  })
})
