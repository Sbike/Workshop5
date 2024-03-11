import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
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


  let nodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null
  };

  const messages: Record<number, any[]> = {};

  node.post("/message", async (req, res) => {
    const { k, x, messageType } = req.body;

    if (!messages[k]) {
      messages[k] = [];
    }

    messages[k].push({ x, messageType });

    if (messageType === "R") {
      if (messages[k].filter((msg) => msg.messageType === "R").length >= N - F) {
        const valueCounts = messages[k].reduce((counts, msg) => {
          counts[msg.x] = (counts[msg.x] || 0) + 1;
          return counts;
        }, {});

        let proposedValue = "?";
        for (const value in valueCounts) {
          if (valueCounts[value] > N / 2) {
            proposedValue = value;
            break;
          }
        }

        for (let i = 0; i < N; i++) {
          if (i !== nodeId) {
            await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, { k, x: proposedValue, messageType: "P" });
          }
        }
      }
    } else if (messageType === "P") {
      if (messages[k].filter((msg) => msg.messageType === "P").length >= N - F) {
        const valueCounts = messages[k].reduce((counts, msg) => {
          counts[msg.x] = (counts[msg.x] || 0) + 1;
          return counts;
        }, {});

        let decidedValue = null;
        for (const value in valueCounts) {
          if (value !== "?" && valueCounts[value] >= F + 1) {
            decidedValue = value;
            break;
          }
        }

        if (decidedValue !== null) {
          nodeState.decided = true;
          nodeState.x = decidedValue as Value;
        } else {
          let nonQuestionValue = null;
          for (const value in valueCounts) {
            if (value !== "?") {
              nonQuestionValue = value;
              break;
            }
          }

          if (nonQuestionValue !== null) {
            nodeState.x = nonQuestionValue as Value;
          } else {
            nodeState.x = Math.random() < 0.5 ? 0 : 1;
          }
        }
      }
    }
    res.status(200).send();
  });



  node.get("/start", async (req, res) => {
    if (nodeState.killed) {
      res.status(500).send("Node is killed");
      return;
    }
    if (isFaulty) {
      nodeState.decided = null;
      nodeState.x = null;
        nodeState.k = null;
    }
    else {

    }
    nodeState.decided = false;
    nodeState.x = initialValue;
    nodeState.k = 1;

    // Send a proposal message (R, k, x) to all other processes
    for (let i = 0; i < N; i++) {
        await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: nodeState.k, x: nodeState.x, messageType: "R" });
    }

    res.status(200).send();
  });

  node.get("/stop", (req, res) => {
    nodeState.killed = true;
    res.status(200).send("killed");
  });

  node.get("/getState", (req, res) => {
    res.status(200).send({ x: nodeState.x, k: nodeState.k, isFaulty, decided: nodeState.decided });
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}
