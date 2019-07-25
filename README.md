init(player)
setState(state) => bool:changed?
getPlayerState() => playerState
receiveAction(action) => state

todo

[√] add a simple test
[ ] add database
[ ] need a real join/leave game protocol

    ## RESTful

    POST /games
    body zip of bundled game

    create game(type) => id (better as rest?)

    GET /games/:id/* (any resource bundled in the game)

    GET /sessions/:id
    get db info about the game
    {
      players: [...'names']
      state: started|in-progress|finished
    }

    POST /sessions (json)
      {type}

    ## Websocket

    use JWT to authenticate

    connect to /

    incoming

    ### Join a game
    {type:"joinGame", id:"game id"}

    ### Start the game     start game // only the creator can do this
    {type:"startGame"}

    ### Send a game action
    {type:"action", body: {...action}}

    outgoing

    ### Player joined
    {type:"gameJoined", playerId:"some player id"}

    ### Game started
    {type:"gameStarted"}

    ### New state
    {type:"playerState", state: {...state}}
