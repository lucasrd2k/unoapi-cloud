import { Request, Response } from 'express'
import { RegistrationController } from '../../src/controllers/registration_controller'
import { setConfig } from '../../src/services/redis'
import { UNOAPI_SERVER_NAME } from '../../src/defaults'

jest.mock('../../src/services/redis', () => ({
  setConfig: jest.fn(),
}))

describe('registro de sessão', () => {
  const phone = '5562982296400'

  const response = () => {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    }
    res.status.mockReturnValue(res)
    return res as unknown as Response
  }

  const request = {
    method: 'POST',
    params: { phone },
    query: {},
    body: { provider: 'zapo' },
  } as unknown as Request

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test.each(['online', 'connecting'])('não recarrega uma sessão %s', async (status) => {
    const sessionStore = { getStatus: jest.fn().mockResolvedValue(status) }
    const config = {
      provider: 'zapo',
      getStore: jest.fn().mockResolvedValue({ sessionStore }),
    }
    const getConfig = jest.fn().mockResolvedValue(config)
    const reload = { run: jest.fn() }
    const controller = new RegistrationController(getConfig, reload as never, {} as never)
    const res = response()

    await controller.register(request, res)

    expect(setConfig).toHaveBeenCalledWith(phone, {
      ...request.body,
      server: UNOAPI_SERVER_NAME,
    })
    expect(reload.run).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ provider: 'zapo', status }))
  })

  test('recarrega somente quando a sessão está inativa', async () => {
    const sessionStore = {
      getStatus: jest.fn()
        .mockResolvedValueOnce('disconnected')
        .mockResolvedValueOnce('connecting'),
    }
    const config = {
      provider: 'zapo',
      getStore: jest.fn().mockResolvedValue({ sessionStore }),
    }
    const reload = { run: jest.fn().mockResolvedValue(undefined) }
    const controller = new RegistrationController(
      jest.fn().mockResolvedValue(config),
      reload as never,
      {} as never,
    )
    const res = response()

    await controller.register(request, res)

    expect(reload.run).toHaveBeenCalledTimes(1)
    expect(reload.run).toHaveBeenCalledWith(phone)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'connecting' }))
  })

  test('preserva o servidor informado explicitamente pelo cliente', async () => {
    const sessionStore = { getStatus: jest.fn().mockResolvedValue('online') }
    const config = {
      provider: 'zapo',
      getStore: jest.fn().mockResolvedValue({ sessionStore }),
    }
    const controller = new RegistrationController(
      jest.fn().mockResolvedValue(config),
      { run: jest.fn() } as never,
      {} as never,
    )
    const req = {
      ...request,
      body: { ...request.body, server: 'servidor-personalizado' },
    } as unknown as Request

    await controller.register(req, response())

    expect(setConfig).toHaveBeenCalledWith(phone, {
      ...request.body,
      server: 'servidor-personalizado',
    })
  })

  test.each(['online', 'connecting'])(
    'permite que uma solicitação manual force a reconexão de uma sessão %s',
    async (status) => {
      const sessionStore = {
        getStatus: jest.fn()
          .mockResolvedValueOnce(status)
          .mockResolvedValueOnce('connecting'),
        setStatus: jest.fn().mockResolvedValue(undefined),
      }
      const config = {
        provider: 'zapo',
        getStore: jest.fn().mockResolvedValue({ sessionStore }),
      }
      const reload = { run: jest.fn().mockResolvedValue(undefined) }
      const controller = new RegistrationController(
        jest.fn().mockResolvedValue(config),
        reload as never,
        {} as never,
      )
      const req = {
        ...request,
        query: { force_reconnect: 'true' },
      } as unknown as Request
      const res = response()

      await controller.register(req, res)

      expect(sessionStore.setStatus).toHaveBeenCalledWith(phone, 'offline')
      expect(reload.run).toHaveBeenCalledWith(phone)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'connecting' }))
    },
  )
})
