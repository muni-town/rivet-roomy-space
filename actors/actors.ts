import { setup } from "rivetkit";

import { operatorAuth } from "./actors/operatorAuth";
import { roomySink } from "./actors/roomySink";
import { streamplaceSource } from "./actors/streamplaceSource";
import { convertStreamplaceToRoomy } from "./actors/convertStreamplaceToRoomy";

export const registry = setup({
  use: {
    operatorAuth,
    roomySink,
    streamplaceSource,
    convertStreamplaceToRoomy,
  },
});
