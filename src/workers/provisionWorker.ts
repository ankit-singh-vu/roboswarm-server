// Environment variables
require("dotenv").config();

import { dequeue, enqueue } from "../lib/events";
import { ProvisionEvent, WorkerEventType, SwarmProvisionEvent, MachineProvisionEvent, DeprovisionEvent, DataCaptureEvent } from "../interfaces/provisioning.interface";
import {
    processDeprovisionEvent,
    processSwarmProvisionEvent,
    processMachineProvisionEvent
} from "../lib/setupHelpers";

// console.log("process.env");

// console.log(JSON.stringify(process.env, null, 2));


console.log("inside provisionWorker");
console.log("Starting worker process with 10 threads...");
(() => {
    let threadPool = 10;
    const interval = setInterval(async () => {
        try {
            if (threadPool > 0) {
                threadPool -= 1;
                const workItem: ProvisionEvent|DeprovisionEvent = await dequeue();
                if (workItem) {
                    switch (workItem.eventType) {
                        case WorkerEventType.SWARM_PROVISION:
                            await processSwarmProvisionEvent(workItem as SwarmProvisionEvent);
                            break;
                        case WorkerEventType.MACHINE_PROVISION:
                            await processMachineProvisionEvent(workItem as MachineProvisionEvent);
                            break;
                        case WorkerEventType.DEPROVISION:
                            await processDeprovisionEvent(workItem as DeprovisionEvent);
                            break;
                        default:
                            console.log(`Fell through on workItem ${workItem.eventType}, re-enqueuing...`);
                            await enqueue(workItem);
                            break;
                    }
                    threadPool += 1;
                } else {
                    threadPool += 1;
                }
            }
        } catch (err) {
            threadPool += 1;
        }
    }, 500);

    const stopProcess = () => {
        console.log("Stopping worker process in 20 seconds...");
        clearInterval(interval);
        setTimeout(() => {
            process.exit();
        }, 20000);
    };
    process.on("SIGINT", stopProcess);
    process.on("SIGTERM", stopProcess);
})();