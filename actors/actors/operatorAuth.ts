import { actor } from "rivetkit";
import { EdDSASigner } from "iso-signatures/signers/eddsa.js";

export const operatorAuth = actor({
  state: {
    privateKey: "",
    adminDids: [] as string[],
  },
  onCreate: async (c, input?: { adminDids?: string[] }) => {
    // This is a singleton actor that can only be created as "main"
    if (c.key.length != 1 || c.key[0] != "main") {
      // If this actor is not "main" immediately destroy it
      c.destroy();
    }

    // // Error if no admin DIDs were specified
    // if (
    //   !input?.adminDids?.length ||
    //   !input.adminDids.every((x) => typeof x == "string")
    // ) {
    //   console.error(
    //     "Cannot create operatorAuth actor without specifying admin list.",
    //   );
    //   c.destroy();
    //   return;
    // }

    // // Set the admin IDS
    // c.state.adminDids = input.adminDids;

    // Generate a new signing key
    c.state.privateKey = (await EdDSASigner.generate()).export();
  },
  vars: undefined as unknown as {
    signer: EdDSASigner;
  },
  createVars: async (c) => ({
    signer: await EdDSASigner.import(c.state.privateKey),
  }),
  actions: {
    /** Get the signing key for the operator actor. */
    signingKey(c) {
      return c.vars.signer.toString();
    },
  },
});
