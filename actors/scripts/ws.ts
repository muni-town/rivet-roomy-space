import "../mokeypatchProxySupport";

const ws = new WebSocket("wss://echo.websocket.org");

ws.onopen = () => {
  console.log("open");
  ws.send("test 123");
  ws.send("test 123");
};

ws.onmessage = (ev) => {
  console.log("echo from server:", ev.data);
};
