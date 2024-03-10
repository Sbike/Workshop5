import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";
import axios from 'axios';

export async function node(
    nodeId: number, // the ID of the node
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value, // initial value of the node
    isFaulty: boolean, // true if the node is faulty, false otherwise
    nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
    setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  let x = initialValue;
  let k = 0;

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

  const messages: Record<number, any[]> = {};

  async function sendMessage(recipient: number, message: any) {
    if (!nodesAreReady()) {
      throw new Error('Not all nodes are ready');
    }
    await axios.post(`http://localhost:${BASE_NODE_PORT + recipient}/message`, message);

  }

  async function waitForMessages(k: number, count: number) {
    const startTime = Date.now();
    while (!messages[k] || messages[k].length < count) {
      if (Date.now() - startTime > 5000) {
        return false;
      }
      await delay(1000);
    }
    return true;
  }

  async function startRound() {
    while (true) {
      k++;
      for (let i = 0; i < N; i++) {
        if (i !== nodeId) {
          await sendMessage(i, { k, type: 'R', value: x });
        }
      }

      const receivedR = await waitForMessages(k, N - F);
      if (receivedR) {
        const v = messages[k].find(msg => msg.type === 'R').value;
        const moreThanHalf = messages[k].filter(msg => msg.type === 'R' && msg.value === v).length > N / 2;
        for (let i = 0; i < N; i++) {
          if (i !== nodeId) {
            await sendMessage(i, { k, type: 'P', value: moreThanHalf ? v : '?' });
          }
        }
      }

      const receivedP = await waitForMessages(k, N - F);
      if (receivedP) {
        const v = messages[k].find(msg => msg.type === 'P' && msg.value !== '?').value;
        const atLeastFPlusOne = messages[k].filter(msg => msg.type === 'P' && msg.value === v).length >= F + 1;
        if (atLeastFPlusOne) {
          console.log(`Node ${nodeId} decided on value ${v}`);
        }
        if (v) {
          x = v;
        } else {
          x = Math.random() < 0.5 ? 0 : 1;
        }
      }
    }
  }

  node.post("/message", async (req, res) => {
    const { round: messageRound, type, value } = req.body;
    if (!messages[k]) {
      messages[k] = [];
    }
    messages[k].push({ type, value });
    res.status(200).json({ k, type, value });
  });

  node.get("/start", async (req, res) => {
    if (!nodesAreReady()) {
      throw new Error('Not all nodes are ready');
    }
    startRound();
    res.status(200).send();
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  server.on('listening', () => {
    const address = server.address();
    if (typeof address === 'string') {
      console.log(`Server is listening at ${address}`);
    } else if (address) {
      console.log(`Server is listening on port ${address.port}`);
    }
  });

  server.on('error', (error) => {
    console.error(`Error occurred: ${error.message}`);
  });

  return server;
}