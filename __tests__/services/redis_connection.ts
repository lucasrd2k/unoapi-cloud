jest.mock('@redis/client', () => ({
  createClient: jest.fn(),
}))

describe('conexão Redis', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  test('compartilha a mesma conexão quando há inicializações simultâneas', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const redisClient = {
      isOpen: true,
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler)
        return redisClient
      }),
      set: jest.fn().mockResolvedValue('OK'),
    }
    const { createClient } = require('@redis/client') as typeof import('@redis/client')
    const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>
    mockCreateClient.mockReturnValue(redisClient as never)

    const redis = require('../../src/services/redis') as typeof import('../../src/services/redis')
    const [first, second] = await Promise.all([
      redis.startRedis('redis://teste'),
      redis.startRedis('redis://teste'),
    ])

    expect(first).toBe(redisClient)
    expect(second).toBe(redisClient)
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(redisClient.connect).toHaveBeenCalledTimes(1)
  })

  test('mantém o cliente ativo após um erro transitório do socket', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const redisClient = {
      isOpen: true,
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler)
        return redisClient
      }),
      set: jest.fn().mockResolvedValue('OK'),
    }
    const { createClient } = require('@redis/client') as typeof import('@redis/client')
    const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>
    mockCreateClient.mockReturnValue(redisClient as never)

    const redis = require('../../src/services/redis') as typeof import('../../src/services/redis')
    await redis.startRedis('redis://teste')
    handlers.get('error')?.(new Error('Socket fechado inesperadamente'))
    await redis.setMessageDirection('5511999999999', '5511888888888', 'incoming')

    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(redisClient.set).toHaveBeenCalledWith(
      'unoapi-message-direction:5511999999999:5511888888888',
      'incoming',
      expect.objectContaining({ EX: expect.any(Number) }),
    )
  })
})
