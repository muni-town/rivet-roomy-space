import { actor, type ActorDefinition } from "rivetkit";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Store } from "iso-ucan/store";
import { type } from "arktype";
import { kvDriver, validateAdminInvocation } from "../ucan";
import { Delegation } from "iso-ucan/delegation";
import type { registry } from "../actors";
import { MemoryDriver } from "iso-kv/drivers/memory.js";
import { DID } from "iso-did";
import { sleep } from "rivetkit/utils";
import { JetstreamEvent, JetstreamSubscription } from "@atcute/jetstream";
import { Did } from "@atproto/api";

const TargetQueue = type({
  actorKind: "string",
  actorKey: "string[]",
  queueName: "string",
});

const ActorCreateInput = type({
  /** The streamplace stream to subscribe to. */
  streamplaceStreamDid: "string",
  /** The time and date to start sourcing from streamplace.  */
  startDate: "string.date.parse",
  /** The time and date to stop sourcing from streamplace. */
  endDate: "string.date.parse",
  /** The actor and queue to send messages to. */
  targetQueue: TargetQueue,
  /** Create actor invocation signed by the operatorAuth actor. */
  invocation: type.instanceOf(Uint8Array),
  /** Delegations neede */
  delegations: "string[]",
});
const ConnParams = type({}).or(type.undefined);
type State = {
  privateKey: string;
  streamplaceStreamDid: string;
  operatorAuthDid: string;
  startDate: Date;
  endDate: Date;
  targetQueue: typeof TargetQueue.infer;
};
type ConnState = undefined;
type Vars = {
  signer: EdDSASigner;
  store: Store;
  operatorAuthDid: DID;
};

export const streamplaceSource = actor({
  state: {
    streamplaceStreamDid: "",
    privateKey: "",
    operatorAuthDid: "",
    startDate: new Date(0),
    endDate: new Date(0),
    targetQueue: {
      actorKey: [] as string[],
      actorKind: "",
      queueName: "",
    },
  },
  onCreate: async (c, rawInput) => {
    try {
      // Parse creation args
      const input = ActorCreateInput(rawInput);
      if (input instanceof type.errors) {
        console.error("Invalid creation input to operatorAuth:", input.summary);
        c.destroy();
        return;
      }

      // Get the operator auth key
      const operatorAuth = c.client<typeof registry>().operatorAuth.get("main");
      const operatorAuthDidStr = await operatorAuth.signingKey();
      const operatorAuthDid = await DID.fromString(operatorAuthDidStr);

      // Load delegations
      const store = new Store(new MemoryDriver());
      await store.add(
        await Promise.all(
          input.delegations.map((x) => Delegation.fromString(x)),
        ),
      );

      // Validate the invocation to create the the actor is valid
      await validateAdminInvocation({
        expectedCmd: "/actor/create",
        operatorAuthDid,
        invocation: input.invocation,
        store,
      });

      // Generate a private key
      const key = await EdDSASigner.generate();

      // Initialize state
      c.state.streamplaceStreamDid = input.streamplaceStreamDid;
      c.state.startDate = input.startDate;
      c.state.endDate = input.endDate;
      c.state.privateKey = key.export();
      c.state.operatorAuthDid = operatorAuthDidStr;
      c.state.targetQueue = input.targetQueue;
    } catch (e) {
      // If there is an error during creation, log the error and destroy the actor.
      console.error(e);
      c.destroy();
    }
  },

  createVars: async (c): Promise<Vars> => {
    // This can happen if creation fails, but this lifecycle hook will still run
    // biome-ignore lint/suspicious/noExplicitAny: we don't use the resulting value.
    if (c.aborted) return undefined as any;

    return {
      signer: await EdDSASigner.import(c.state.privateKey),
      store: new Store(kvDriver(c.kv)),
      operatorAuthDid: await DID.fromString(c.state.operatorAuthDid),
    };
  },

  createConnState: async (): Promise<ConnState> => {
    return;
  },

  actions: {
    /** Get the signing key for the operator actor. */
    signingKey(c) {
      return c.vars.signer.toString();
    },
    /** Wake the actor. The run handler will perform any necessary actions. */
    wake() {},
  },

  onWake(c) {
    const now = Date.now();
    const start = c.state.startDate.getTime();

    if (start > now) {
      // Schedule the actor to wake at the start time
      console.log(
        `Scheduling actor wake for in ${(start - now) / 1000} seconds`,
      );
      c.schedule.after(start - now, "wake");

      // If we are starting in more than a minute, sleep the actor
      if (start - now > 60000) {
        c.sleep();
      }
    }
  },

  async run(c) {
    const now = Date.now();
    const start = c.state.startDate.getTime();
    const end = c.state.endDate.getTime();

    // If we are past the end time, then we are done!
    if (end < now) {
      console.log("We're done with this actor, stream is over!");
      c.destroy();
      return;
    }

    // Sleep until the start time if we aren't ready to start yet
    const untilStart = start - now;
    console.log(
      `Actor runner started with ${untilStart / 1000} seconds untill start`,
    );
    if (untilStart > 60000) {
      c.sleep();
    }

    await sleep(untilStart);

    // Get a handle to the actor we are going to send messages to
    const targetActor = c
      .client()
      .get(c.state.targetQueue.actorKind, c.state.targetQueue.actorKey);

    // Time to start streaming!
    await c.keepAwake(
      (async () => {
        console.log("Starting streaming");
        const now = Date.now();
        const finish = sleep(end - now).then((_) => "finished" as const);

        // Subscribe to the jetstream for the configured streamplace stream.
        const subscription = new JetstreamSubscription({
          url: "wss://jetstream2.us-east.bsky.network",
          wantedCollections: ["place.stream.chat.message"],
        });
        const iterator = subscription[Symbol.asyncIterator]();

        while (true) {
          // Get the next event or the finish promise
          const race = await Promise.race([finish, iterator.next()]);
          // Break out if we're finished
          if (race == "finished") break;

          // Get the event
          const event = race.value as JetstreamEvent;

          // Ignore irrelevant events
          if (event.kind != "commit") continue;

          // Ignore messages that aren't in the stream that we are interested in
          if (
            "record" in event.commit &&
            (event.commit.record as { streamer?: string })?.streamer !==
              c.state.streamplaceStreamDid
          ) {
            continue;
          }

          // Queue the commit event to the target queue
          try {
            await targetActor.send(c.state.targetQueue.queueName, event);
          } catch (e) {
            console.error(e);
          }
        }

        // Tell the target queue that we are done streaming events.
        try {
          console.log("Sending finished");
          await targetActor.send(c.state.targetQueue.queueName, "finished");
        } catch (e) {
          console.error(e);
        }
      })(),
    );

    console.log("done streaming");
    c.destroy();

    while (true) {
      if (c.aborted) break;
      await sleep(1000);
    }
    console.log("exiting source");
  },
}) satisfies ActorDefinition<
  State,
  typeof ConnParams.infer,
  ConnState,
  Vars,
  typeof ActorCreateInput.infer,
  // biome-ignore lint/suspicious/noExplicitAny: we don't use the DB so we just need any here.
  any
>;
