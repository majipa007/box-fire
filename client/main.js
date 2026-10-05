// Boot: connect to the host and drive the screens.
import { connect } from './net.js';
import * as ui from './ui.js';
import { cleanName } from '../shared/protocol.js';

let myId = null;

const net = connect({
  welcome(m) {
    myId = m.id;
    ui.showRoom();
  },
  lobby(m) { ui.renderLobby(m, myId); },
  reject(m) { ui.showJoinError(m.reason); },
  close() { ui.showDisconnected(); },
});

ui.onJoin((raw) => {
  const name = cleanName(raw);
  if (name) net.send({ t: 'join', name });
  else ui.showJoinError('bad-name');
});
ui.onStart(() => net.send({ t: 'start' }));
