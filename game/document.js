const GameElement = require('./element');
const Space = require('./space');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

class GameDocument extends Space {
  constructor(node, game) {
    let rootNode = node;
    if (!rootNode) {
      // initial call to build the base DOM
      const dom = new JSDOM('<game><board id="board" class="space"></board><pile class="space"></pile></game>');
      rootNode = dom.window.document.getElementsByTagName('game')[0]
    }
    super(rootNode, { game, doc: rootNode });
  }

  clone() {
    return new GameDocument(this.doc.cloneNode(true), this.game);
  }
}

GameElement.wrapNodeAs(0, GameDocument, node => !node.parentNode);

module.exports = GameDocument
