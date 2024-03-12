import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import axios from 'axios';
import * as console from "console";
import {delay} from "../utils";


export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });


  let nodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null
  };

  let messagesR: Map<number, any[]> = new Map();
  let messagesP: Map<number, any[]> = new Map();

  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body;
    if (!isFaulty && !nodeState.killed) {
      if (messageType == "R") {
        if (!messagesR.has(k)) {
          messagesR.set(k, []);
        }
        messagesR.get(k)!.push(x)
        let messageR = messagesR.get(k)!;
        if (messageR.length >= (N - F)) {
          let count0 = messageR.filter((el) => el == 0).length;
          let count1 = messageR.filter((el) => el == 1).length;
          if (count0 > (N / 2)) {
            x = 0;
          } else if (count1 > (N / 2)) {
            x = 1;
          } else {
            x = "?";
          }
          for (let i = 0; i < N; i++) {
              await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {k: k, x: x, messageType: "P"});
          }
        }
      } else if (messageType == "P") {
        if (!messagesP.has(k)) {
          messagesP.set(k, []);
        }
        messagesP.get(k)!.push(x)
        let messageP = messagesP.get(k)!;
        if (messageP.length >= N - F) {
          console.log("P", messageP,"node :",nodeId,"k :",k)
          let count0 = messageP.filter((el) => el == 0).length;
          let count1 = messageP.filter((el) => el == 1).length;

          if (count0 >= F + 1) {
            nodeState.x = 0;
            nodeState.decided = true;
          } else if (count1 >= F + 1) {
            nodeState.x = 1;
            nodeState.decided = true;
          } else {
            if (count0 + count1 > 0 && count0 > count1) {
              nodeState.x = 0;
            } else if (count0 + count1 > 0 && count0 < count1) {
              nodeState.x = 1;
            } else {
              nodeState.x = Math.random() > 0.5 ? 0 : 1;
            }
            nodeState.k = k + 1;
            for (let i = 0; i < N; i++) {
                await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {k: k, x: x, messageType: "R"});
            }
          }
        }
      }
    }
    res.status(200).send("message received");
  });


  node.get("/start", async (req, res) => {

    while (!nodesAreReady()) {
      await delay(5);
    }

    if (!isFaulty) {
      nodeState.decided = false;
      nodeState.x = initialValue;
      nodeState.k = 1;
      //sends a proposal message (R, k, x) to all other processes
      for (let i = 0; i < N; i++) {
        await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          k: nodeState.k,
          x: nodeState.x,
          messageType: "R"
        });
      }
    }
    else {
      nodeState.decided = null;
      nodeState.x = null;
      nodeState.k = null;
    }
    res.status(200).send("started");
  });

  node.get("/stop", (req, res) => {
    nodeState.killed = true;
    res.status(200).send("killed");
  });

  node.get("/getState", (req, res) => {
    res.status(200).send({ x: nodeState.x, k: nodeState.k, killed: nodeState.killed, decided: nodeState.decided });
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}
