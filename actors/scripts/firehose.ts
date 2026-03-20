import "../monkeypatchProxySupport";
import { JetstreamSubscription } from "@atcute/jetstream";

const subscription = new JetstreamSubscription({
  url: "wss://jetstream2.us-east.bsky.network",
  wantedCollections: ["place.stream.chat.message"]
});

for await (const event of subscription) {
  if (event.kind != "commit") continue;

  if (event.commit.operation !== "delete") {
    console.log(event.commit.record);
  }
}
