import { actor, queue, type ActorDefinition } from "rivetkit";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";
import { Store } from "iso-ucan/store";
import { type } from "arktype";
import { kvDriver, validateAdminInvocation } from "../ucan";
import { Delegation } from "iso-ucan/delegation";
import type { registry } from "../actors";
import { MemoryDriver } from "iso-kv/drivers/memory.js";
import { DID } from "iso-did";
import { sleep } from "rivetkit/utils";
import {
  CommitEvent,
  JetstreamEvent,
  JetstreamSubscription,
} from "@atcute/jetstream";
import { Did } from "@atproto/api";

const TargetQueue = type({
  actorKind: "string",
  actorKey: "string[]",
  queueName: "string",
});

const ActorCreateInput = type({
  /** The actor and queue to send Roomy events to. */
  targetQueue: TargetQueue,
  /** Create actor invocation signed by the operatorAuth actor. */
  invocation: type.instanceOf(Uint8Array),
  /** Delegations needed. */
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

export const convertStreamplaceToRoomy = actor({
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
  },

  queues: {
    events: queue<CommitEvent | "finished">(),
  },

  async run(c) {
    for await (const message of c.queue.iter()) {
      console.log(message);

      // If this is the last message, we can clean up this actor
      if (message.body == "finished") {
        c.destroy();
        while (true) {
          if (c.aborted) break;
          await sleep(1000);
        }
        console.log("exiting converter");
      }
    }
  },
});
