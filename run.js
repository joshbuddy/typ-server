const createServer = require('./server')
const server = createServer({redis_url: "redis://localhost:6379"})
server.listen(3000)