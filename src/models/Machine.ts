import { DropletResponse, NetworkInterface } from "../interfaces/digitalOcean.interface";
import { db } from "../lib/db";
import { Swarm } from "./Swarm";
import * as SwarmMachine from "./SwarmMachine";
import { SSHKey } from "./SSHKey";
import { enqueue } from "../lib/events";
import { MachineProvisionEvent, WorkerEventType, MachineSetupStep } from "../interfaces/provisioning.interface";
import * as moment from "moment";
import { generateVmConfigurationScript } from "../lib/templateGeneration";
import { httpRequest, RequestOptions } from "../lib/http";

export interface Machine {
    id: number;
    external_id?: number;
    ip_address?: string;
    created_at: Date;
    ready_at?: Date;
    destroyed_at?: Date;
    setup_complete: boolean;
    file_transfer_complete: boolean;
    is_master: boolean;
    dependency_install_complete: boolean;
    port_open_complete: boolean;
    traceroute?: string;
    test_started?: boolean;
}

export interface NewMachine {
    region: string;
}

export async function findById(machineId: number): Promise<Machine> {
    const machineList: Array<Machine> = await db("machine").where("id", "=", machineId);
    return machineList[0];
}

export async function create(machine: NewMachine, swarm: Swarm, key: SSHKey): Promise<Machine> {
    const newMachineList: Array<Machine> = await db("machine")
        .insert({ created_at: db.fn.now() })
        .returning("*");
    const newMachine = newMachineList[0];

    // Create the machine-swarm join entry
    const join: SwarmMachine.SwarmMachine = {
        machine_id: newMachine.id,
        swarm_id: swarm.id
    };
    await SwarmMachine.create(join);

    // Create provision event push into work queue.
    // DO WE EVEN NEED THIS?
    const machineProvisionEvent: MachineProvisionEvent = {
        swarm,
        stepToExecute: MachineSetupStep.CREATE,
        steps: [],
        sshKey: key,
        machine: newMachine,
        region: machine.region,
        eventType: WorkerEventType.MACHINE_PROVISION,
        maxRetries: 10,
        currentTry: 0,
        lastActionTime: new Date(),
        errors: []
    };
    await enqueue(machineProvisionEvent);

    return newMachine;
}

export async function createExternalMachine(id: number, region: string, externalSshKeyId: number): Promise<DropletResponse|boolean> {
    try {
        // Fire off an api request.
        const DOMachine: DropletResponse = await createDigitalOceanMachine(id, region, externalSshKeyId);

        // Store the external id.
        await db("machine")
            .update({ external_id: DOMachine.droplet.id })
            .where("id", id)
            .returning("*");
        return DOMachine;
    } catch (err) {
        return false;
    }
}

export async function checkStatus(machine: Machine): Promise<DropletResponse> {
    const headers = {
        Authorization: `Bearer ${process.env.ROBOSWARM__DIGITAL_OCEAN_TOKEN}`,
        "Content-Type": "application/json"
    };
    const url = `https://api.digitalocean.com/v2/droplets/${machine.external_id}`;
    const options: RequestOptions = {
        method: "GET",
        url,
        headers
    };
    return httpRequest<DropletResponse>(options);
}

// Starts the creation of machine on Digital Ocean. Should only ever be used
// in conjunction with creating a machine on RoboSwarm.
async function createDigitalOceanMachine(machineId: number, region: string, digitalOceanSSHKeyId: number): Promise<DropletResponse> {
    console.log("inside createDigitalOceanMachine");
    const headers = {
        Authorization: `Bearer ${process.env.ROBOSWARM__DIGITAL_OCEAN_TOKEN}`,
        "Content-Type": "application/json"
    };
    const body = {
        name: `${machineId}`,
        region,
        size: "s-2vcpu-2gb",
        image: process.env.ROBOSWARM__DIGITALOCEAN_SNAPSHOT_ID,
        backups: false,
        ipv6: true,
        tags: [ "roboswarm" ],
        user_data: await generateVmConfigurationScript(machineId),
        ssh_keys: [
            digitalOceanSSHKeyId,
            // You can add extra DigitalOcean SSH Key ids here for debugging
        ]
    };
    const url = "https://api.digitalocean.com/v2/droplets";
    const options: RequestOptions = {
        method: 'POST',
        url,
        body,
        headers
    };

    console.log("options");
    console.log(options);
    return httpRequest<DropletResponse>(options);
}

export async function destroy(machineId: number): Promise<void> {
    const machine = await findById(machineId);
    const headers = {
        Authorization: `Bearer ${process.env.ROBOSWARM__DIGITAL_OCEAN_TOKEN}`,
        "Content-Type": "application/json"
    };
    const url = `https://api.digitalocean.com/v2/droplets/${machine.external_id}`;
    const options: RequestOptions = {
        headers,
        url,
        method: 'DELETE'
    };
    await httpRequest(options);
    await db("machine")
        .update({ destroyed_at: db.fn.now() })
        .where("id", machine.id)
        .returning("*");
}

export async function setReadyAtAndIp(machine: Machine, ip_address: string): Promise<Machine> {
    const updatedMachineList: Array<Machine> = await db("machine")
        .update({
            ip_address,
            ready_at: db.fn.now()
        })
        .where("id", machine.id)
        .returning("*");
    return updatedMachineList[0];
}

export async function updateFileTransferStatus(machineId: number, status: boolean): Promise<any> {
    await db("machine")
        .update({ file_transfer_complete: status })
        .where("id", machineId);
}

export async function updateSetupCompleteStatus(machineId: number, status: boolean): Promise<any> {
    await db("machine")
        .update({ setup_complete: status })
        .where("id", machineId);
}

export async function updateIsMaster(id: number, is_master: boolean): Promise<void> {
    await db("machine")
        .update({ is_master })
        .where("id", id);
}

export async function updateDependencyInstallComplete(id: number, dependency_install_complete: boolean): Promise<void> {
    await db("machine")
        .update({ dependency_install_complete })
        .where("id", id);
}

export async function update(id: number, data: any): Promise<void> {
    await db("machine")
        .update(data)
        .where("id", id);
}

export async function shouldDeprovision(id: number): Promise<boolean> {
    const m: Machine = await findById(id);
    const timeStamp: moment.Moment = moment(m.created_at);
    const diff: number = timeStamp.diff(moment(), "minutes");
    return diff >= 4;

}

export async function isReady(id: number): Promise<boolean> {
    console.log(`Checking machine ready: ${id}`);
    const m = await findById(id);
    if (m.ready_at === null) {
        const response = await checkStatus(m);
        if (response.droplet.status === "active") {
            const nic: NetworkInterface = response.droplet.networks.v4.find(n => n.type === "public");
            await setReadyAtAndIp(m, nic.ip_address);
            console.log(`Machine ready: ${id}`);
            return true;
        }
    }
    return false;
}

export async function setIsMaster(machine: Machine): Promise<void> {
    const swarmId = await SwarmMachine.getSwarmIdByMachineId(machine.id);
    await db.transaction(async (trx: any) => {
        const swarmMachines: SwarmMachine.SwarmMachine[] = await db("swarm_machine")
            .where({ swarm_id: swarmId })
            .transacting(trx);
        const machines: Machine[] = await db("machine")
            .whereIn("id", swarmMachines.map(sm => sm.machine_id))
            .transacting(trx);
        if (machines.find(m => m.is_master === true) === undefined) {
            await db("machine")
                .update({ is_master: true })
                .where({ id: machine.id })
                .transacting(trx);
        }
        await trx.commit();
    });
}