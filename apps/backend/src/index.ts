import { createYoga } from 'graphql-yoga'
import { schema } from './graphql/schema'
import { healthHandler } from './routes/health'

const yoga = createYoga({ schema })

const server = Bun.serve({
  port: process.env.PORT || 4000,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return healthHandler(req)
    }
    return yoga.handle(req)
  },
})

console.log(`🚀 Server ready at http://localhost:${server.port}`)
