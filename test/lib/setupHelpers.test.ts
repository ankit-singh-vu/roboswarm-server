import * as sinon from "sinon";
import * as setupHelpers from "../../src/lib/setupHelpers";
import { SwarmSetupStep } from "../../src/interfaces/provisioning.interface";
import * as events from "../../src/lib/events";
import { MachineProvisionEvent, MachineSetupStep, DataCaptureEvent, WorkerEventType, DeprovisionEvent, DeprovisionEventType, SwarmProvisionEvent } from "../../src/interfaces/provisioning.interface";
import * as Swarm from "../../src/models/Swarm";
import * as SwarmMachine from "../../src/models/SwarmMachine";
import * as Machine from "../../src/models/Machine";
import * as SSHKey from "../../src/models/SSHKey";
import { Status } from "../../src/interfaces/shared.interface";
import * as lib from "../../src/lib/lib";
import * as moment from "moment";
const Sinon = require("sinon");
import * as swarmProvisionEvents from "../../src/lib/swarmProvisionEvents";
import { DropletResponse } from "../../src/interfaces/digitalOcean.interface";

describe("lib/setupHelpers", () => {
    let sandbox: sinon.SinonSandbox;
    let enqueueStub: sinon.SinonStub;

    beforeAll(() => {
        sandbox = sinon.createSandbox();
    });

    beforeEach(() => {
        enqueueStub = sandbox.stub(events, "enqueue").resolves();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe("nextStep", () => {
        it("enqueue the next step if one exists", async () => {
            const theDate: Date = new Date();
            const event: any = {
                sshKey: undefined,
                eventType: undefined,
                maxRetries: 10,
                currentTry: 10,
                lastActionTime: theDate,
                errors: [],
                swarm: undefined,
                machine: undefined,
                region: "nyc3",
                stepToExecute: MachineSetupStep.CREATE,
                steps: [MachineSetupStep.DELAY, MachineSetupStep.MACHINE_READY]
            };
            await setupHelpers.nextStep(event);
            expect(enqueueStub.callCount).toEqual(1);
            const enqueueArg: MachineProvisionEvent = enqueueStub.getCall(0).args[0];
            expect(enqueueArg).toEqual({
                sshKey: undefined,
                eventType: undefined,
                maxRetries: 10,
                currentTry: 0,
                lastActionTime: theDate,
                errors: [],
                swarm: undefined,
                machine: undefined,
                region: "nyc3",
                stepToExecute: MachineSetupStep.DELAY,
                steps: [MachineSetupStep.MACHINE_READY]
            });
        });

        it("does not enqueue the next step if one does not exist", async () => {
            const theDate: Date = new Date();
            const event: any = {
                sshKey: undefined,
                eventType: undefined,
                maxRetries: 10,
                currentTry: 10,
                lastActionTime: theDate,
                errors: [],
                swarm: undefined,
                machine: undefined,
                region: "nyc3",
                stepToExecute: MachineSetupStep.CREATE,
                steps: []
            };
            await setupHelpers.nextStep(event);
            expect(enqueueStub.callCount).toEqual(0);
        });
    });

    describe("processDeprovisionEvent", () => {
        let baseDeprovisionEvent: DeprovisionEvent;
        let machineDeprovisionStub: sinon.SinonStub;
        let sshKeyDeprovisionStub: sinon.SinonStub;

        beforeEach(() => {
            baseDeprovisionEvent = {
                id: 1,
                eventType: WorkerEventType.DEPROVISION,
                deprovisionType: DeprovisionEventType.MACHINE,
                maxRetries: 5,
                currentTry: 0,
                lastActionTime: new Date(),
                errors: []
            };
            machineDeprovisionStub = sandbox.stub(Machine, "destroy").resolves();
            sshKeyDeprovisionStub = sandbox.stub(SSHKey, "destroy").resolves();
        });

        it("does not process the event if we have reached max retries", async () => {
            const doNotProcess: DeprovisionEvent = {
                ...baseDeprovisionEvent,
                currentTry: 6,
            };
            await setupHelpers.processDeprovisionEvent(doNotProcess);
            expect(machineDeprovisionStub.callCount).toEqual(0);
            expect(sshKeyDeprovisionStub.callCount).toEqual(0);

        });

        it("deprovisions the machine", async () => {
            await setupHelpers.processDeprovisionEvent(baseDeprovisionEvent);
            expect(machineDeprovisionStub.callCount).toEqual(1);
            expect(machineDeprovisionStub.getCall(0).args[0]).toEqual(baseDeprovisionEvent.id);
            expect(sshKeyDeprovisionStub.callCount).toEqual(0);
        });

        it("deprovisions the ssh key", async () => {
            const sshKeyDeprovisionEvent: DeprovisionEvent = {
                ...baseDeprovisionEvent,
                deprovisionType: DeprovisionEventType.SSH_KEY
            };
            await setupHelpers.processDeprovisionEvent(sshKeyDeprovisionEvent);
            expect(machineDeprovisionStub.callCount).toEqual(0);
            expect(sshKeyDeprovisionStub.callCount).toEqual(1);
            expect(sshKeyDeprovisionStub.getCall(0).args[0]).toEqual(sshKeyDeprovisionEvent.id);
        });
    });

    describe("processSwarmProvisionEvent", () => {
        let baseSwarmProvisionEvent: SwarmProvisionEvent;

        beforeEach(() => {
            baseSwarmProvisionEvent = {
                sshKey: {
                    public: "public-key",
                    private: "private-key",
                    created_at: new Date()
                },
                eventType: WorkerEventType.SWARM_PROVISION,
                maxRetries: 10,
                currentTry: 1,
                lastActionTime: new Date(),
                errors: [],
                swarm: {
                    name: "Test Swarm",
                    duration: 20,
                    simulated_users: 200,
                    file_path: "/some/file/path",
                    spawn_rate: 1,
                    machines: [],
                    region: "nyc3",
                    swarm_ui_type: "headless",
                    reliability_test: false,
                    kernl_test: true
                },
                createdSwarm: {
                    id: 1,
                    name: "Test Swarm",
                    status: Status.ready,
                    group_id: 1,
                    user_id: 1,
                    simulated_users: 200,
                    ssh_key_id: 123,
                    host_url: "https://kernl.us",
                    spawn_rate: 1,
                    created_at: new Date(),
                    ready_at: new Date(),
                    destroyed_at: new Date(),
                    region: "nyc3",
                    duration: 20,
                    setup_complete: true,
                    file_transfer_complete: true,
                    swarm_ui_type: "headless"
                },
                stepToExecute: SwarmSetupStep.CREATE,
                steps: [
                    SwarmSetupStep.DELAY,
                ]
            };
        });

        it("drops the event if max tries has been exceeded", async () => {
            const cleanupStub: sinon.SinonStub = sandbox.stub(swarmProvisionEvents, "cleanUpSwarmProvisionEvent").resolves();
            const dropEvent: SwarmProvisionEvent = {
                ...baseSwarmProvisionEvent,
                currentTry: 20
            };
            await setupHelpers.processSwarmProvisionEvent(dropEvent);
            expect(cleanupStub.callCount).toEqual(1);
            expect(cleanupStub.getCall(0).args[0]).toEqual(dropEvent);
        });

        it("it sleeps, increments, and re-enqueues the event if an error is thrown", async () => {
            sandbox.stub(Swarm, "provision").throws();
            const sleepStub: sinon.SinonStub = sandbox.stub(lib, "asyncSleep").resolves();
            const sleepEvent: SwarmProvisionEvent = {
                ...baseSwarmProvisionEvent,
                currentTry: 0
            };
            await setupHelpers.processSwarmProvisionEvent(sleepEvent);
            expect(sleepStub.getCall(0).args[0]).toBe(3);
            expect(enqueueStub.callCount).toBe(1);
            expect(enqueueStub.getCall(0).args[0].currentTry).toBe(1);
        });

        describe("CREATE", () => {
            it("provisions the swarm", async () => {
                const provisionStub: sinon.SinonStub = sandbox.stub(Swarm, "provision").resolves();
                const createEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent
                };
                await setupHelpers.processSwarmProvisionEvent(createEvent);
                expect(enqueueStub.callCount).toBe(1);
                expect(provisionStub.callCount).toBe(1);
                expect(enqueueStub.getCall(0).args[0]).toEqual({
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.DELAY,
                    steps: [],
                    currentTry: 0
                });
            });
        });

        describe("READY", () => {
            it("stops if the swarm is destroyed", async () => {
                sandbox.stub(Swarm, "getById").resolves({
                    destroyed_at: new Date(),
                } as Swarm.Swarm);
                const swarmReadyEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.READY
                };
                await setupHelpers.processSwarmProvisionEvent(swarmReadyEvent);
                expect(enqueueStub.callCount).toBe(0);
            });

            it("sets readyAt if the swarm is ready", async () => {
                sandbox.stub(Swarm, "getById").resolves({
                    destroyed_at: undefined
                } as Swarm.Swarm);
                sandbox.stub(Swarm, "swarmReady").resolves(true);
                const readyAtStub: sinon.SinonStub = sandbox.stub(Swarm, "setReadyAt");
                const swarmReadyEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.READY
                };
                await setupHelpers.processSwarmProvisionEvent(swarmReadyEvent);
                expect(readyAtStub.callCount).toBe(1);
                expect(enqueueStub.callCount).toBe(1);
            });

            it("re-enqueues and waits if the swarm is not ready", async () => {
                sandbox.stub(Swarm, "getById").resolves({
                    destroyed_at: undefined
                } as Swarm.Swarm);
                sandbox.stub(Swarm, "swarmReady").resolves(false);
                const readyAtStub: sinon.SinonStub = sandbox.stub(Swarm, "setReadyAt");
                const swarmReadyEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.READY
                };
                await setupHelpers.processSwarmProvisionEvent(swarmReadyEvent);
                expect(readyAtStub.callCount).toBe(0);
                expect(enqueueStub.callCount).toBe(1);
            });
        });

        describe("DELAY", () => {
            it("doesn't set a delay if NOW is > delayUntil time", async () => {
                const delayUntilMinusOne: moment.Moment = moment().subtract(1, "day");
                const delayEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute:  SwarmSetupStep.DELAY,
                    delayUntil: delayUntilMinusOne.toDate()
                };
                await setupHelpers.processSwarmProvisionEvent(delayEvent);
                expect(enqueueStub.callCount).toBe(1);
                expect(enqueueStub.getCall(0).args[0].delayUntil).toBeUndefined();
            });

            it("adds a delay delay event if the NOW is < delayUntil time", async () => {
                const delayUntilPlusOne: moment.Moment = moment().add(1, "day");
                const delayEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.DELAY,
                    delayUntil: delayUntilPlusOne.toDate()
                };
                await setupHelpers.processSwarmProvisionEvent(delayEvent);
                expect(enqueueStub.callCount).toBe(1);
                expect(enqueueStub.getCall(0).args[0].delayUntil).toBeDefined();
                const steps = enqueueStub.getCall(0).args[0].steps;
                expect(steps[steps.length - 1]).toBe(SwarmSetupStep.DELAY);
                expect(moment(enqueueStub.getCall(0).args[0].delayUntil).toDate().getTime()).toBe(delayUntilPlusOne.toDate().getTime());
            });
        });

        describe("START_MASTER", () => {
            it("enqueues the start master event", async () => {
                sandbox.stub(SwarmMachine, "getSwarmMachineIds").resolves([1, 2, 3]);
                sandbox.stub(Machine, "findById").resolves({
                    id: 1,
                    created_at: new Date(),
                    setup_complete: false,
                    file_transfer_complete: false,
                    is_master: false,
                    port_open_complete: false,
                    dependency_install_complete: false,
                });
                const updateIsMasterStub: sinon.SinonStub = sandbox.stub(Machine, "updateIsMaster").resolves();
                const startMasterEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.START_MASTER
                };
                await setupHelpers.processSwarmProvisionEvent(startMasterEvent);
                expect(updateIsMasterStub.getCall(0).args[0]).toBe(1);
                expect(enqueueStub.callCount).toBe(2);
                const enqueuedEvent: MachineProvisionEvent = enqueueStub.getCall(0).args[0];
                expect(enqueuedEvent.slaveCount).toEqual(2);
                expect(enqueuedEvent.slaveIds).toEqual([2, 3]);
                expect(enqueuedEvent.stepToExecute).toBe(MachineSetupStep.START_MASTER);
            });
        });

        describe("STOP_SWARM", () => {
            it("does nothing if the swarm is already destroyed", async () => {
                const destroyByIdStub: sinon.SinonStub = sandbox.stub(Swarm, "destroyById").resolves();
                const shouldStopStub: sinon.SinonStub = sandbox.stub(Swarm, "shouldStop").resolves();
                const getByIdStub: sinon.SinonStub = sandbox.stub(Swarm, "getById").resolves({
                    status: Status.destroyed
                } as Swarm.Swarm);
                const stopEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.STOP_SWARM
                };
                await setupHelpers.processSwarmProvisionEvent(stopEvent);
                expect(getByIdStub.callCount).toBe(1);
                expect(destroyByIdStub.callCount).toBe(0);
                expect(shouldStopStub.callCount).toBe(0);
                expect(enqueueStub.callCount).toBe(0);
            });

            it("destroys the swarm", async () => {
                const destroyByIdStub: sinon.SinonStub = sandbox.stub(Swarm, "destroyById").resolves();
                const shouldStopStub: sinon.SinonStub = sandbox.stub(Swarm, "shouldStop").resolves(true);
                const getByIdStub: sinon.SinonStub = sandbox.stub(Swarm, "getById").resolves({
                    status: Status.ready
                } as Swarm.Swarm);
                const stopEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.STOP_SWARM
                };
                await setupHelpers.processSwarmProvisionEvent(stopEvent);
                expect(getByIdStub.callCount).toBe(1);
                expect(destroyByIdStub.callCount).toBe(1);
                expect(shouldStopStub.callCount).toBe(1);
                expect(enqueueStub.callCount).toBe(1);
            });

            it("delays for 10 seconds if the swarm is not ready to be destroyed", async () => {
                const destroyByIdStub: sinon.SinonStub = sandbox.stub(Swarm, "destroyById").resolves();
                const shouldStopStub: sinon.SinonStub = sandbox.stub(Swarm, "shouldStop").resolves(false);
                const getByIdStub: sinon.SinonStub = sandbox.stub(Swarm, "getById").resolves({
                    status: Status.ready
                } as Swarm.Swarm);
                const stopEvent: SwarmProvisionEvent = {
                    ...baseSwarmProvisionEvent,
                    stepToExecute: SwarmSetupStep.STOP_SWARM
                };
                await setupHelpers.processSwarmProvisionEvent(stopEvent);
                expect(getByIdStub.callCount).toBe(1);
                expect(destroyByIdStub.callCount).toBe(0);
                expect(shouldStopStub.callCount).toBe(1);
                expect(enqueueStub.callCount).toBe(1);
                expect(enqueueStub.getCall(0).args[0].steps.pop()).toBe(SwarmSetupStep.DELAY);
                expect(enqueueStub.getCall(0).args[0].steps.pop()).toBe(SwarmSetupStep.STOP_SWARM);
            });
        });


    });

    describe("processMachineProvisionEvent", () => {
        let baseMachineProvisionEvent: MachineProvisionEvent;

        beforeEach(() => {
            baseMachineProvisionEvent = {
                sshKey: {
                    public: "public-key",
                    private: "private-key",
                    external_id: 12345,
                    created_at: new Date()
                },
                eventType: WorkerEventType.MACHINE_PROVISION,
                maxRetries: 10,
                currentTry: 1,
                lastActionTime: new Date(),
                errors: [],
                swarm: {
                    name: "Test Swarm",
                    duration: 20,
                    simulated_users: 200,
                    spawn_rate: 1,
                    machines: [],
                    region: "nyc3",
                    swarm_ui_type: "headless",
                } as Swarm.Swarm,
                machine: {
                    id: 1,
                    created_at: new Date(),
                    setup_complete: false,
                    file_transfer_complete: false,
                    is_master: false,
                    port_open_complete: false,
                    dependency_install_complete: false,
                },
                region: "nyc3",
                stepToExecute: MachineSetupStep.CREATE,
                steps: [
                    MachineSetupStep.DELAY
                ]
            };
        });

        it("drops the event if max tries has been exceeded", async () => {
            const createExternalMachineStub: sinon.SinonStub = sandbox.stub(Machine, "createExternalMachine").resolves();
            const dropEvent: MachineProvisionEvent = {
                ...baseMachineProvisionEvent,
                currentTry: 20
            };
            await setupHelpers.processMachineProvisionEvent(dropEvent);
            expect(createExternalMachineStub.callCount).toEqual(0);
        });

        it("it sleeps, increments, and re-enqueues the event if an error is thrown", async () => {
            sandbox.stub(Machine, "createExternalMachine").throws();
            const sleepStub: sinon.SinonStub = sandbox.stub(lib, "asyncSleep").resolves();
            const sleepEvent: MachineProvisionEvent = {
                ...baseMachineProvisionEvent,
                currentTry: 0
            };
            await setupHelpers.processMachineProvisionEvent(sleepEvent);
            expect(sleepStub.getCall(0).args[0]).toBe(3);
            expect(enqueueStub.callCount).toBe(1);
            expect(enqueueStub.getCall(0).args[0].currentTry).toBe(1);
        });

        describe("CREATE", () => {
            it("creates the external machine", async () => {
                const createStub: sinon.SinonStub = sandbox.stub(Machine, "createExternalMachine").resolves({} as DropletResponse);
                const createEvent: MachineProvisionEvent = {
                    ...baseMachineProvisionEvent
                };
                await setupHelpers.processMachineProvisionEvent(createEvent);
                expect(createStub.callCount).toBe(1);
                const [machineId, region, sshKeyId] = createStub.getCall(0).args;
                expect(machineId).toBe(createEvent.machine.id);
                expect(region).toBe(createEvent.region);
                expect(sshKeyId).toBe(createEvent.sshKey.external_id);
                expect(enqueueStub.callCount).toBe(1);
                expect(enqueueStub.getCall(0).args[0].stepToExecute).toBe(MachineSetupStep.DELAY);
            });

            it("removes the machine reference from the swarm if creation fails", async () => {
                const createStub: sinon.SinonStub = sandbox.stub(Machine, "createExternalMachine").resolves(false);
                const swarmUpdateStub: sinon.SinonStub = sandbox.stub(Swarm, "update").resolves();
                const createEvent: MachineProvisionEvent = {
                    ...baseMachineProvisionEvent,
                    swarm: {
                        ...baseMachineProvisionEvent.swarm,
                        size: 4
                    }
                };
                await setupHelpers.processMachineProvisionEvent(createEvent);
                expect(createStub.callCount).toBe(1);
                const [machineId, region, sshKeyId] = createStub.getCall(0).args;
                expect(machineId).toBe(createEvent.machine.id);
                expect(region).toBe(createEvent.region);
                expect(sshKeyId).toBe(createEvent.sshKey.external_id);
                expect(enqueueStub.callCount).toBe(0);
                expect(swarmUpdateStub.callCount).toBe(1);
                expect(swarmUpdateStub.getCall(0).args[0]).toBe(createEvent.swarm.id);
                expect(swarmUpdateStub.getCall(0).args[1]).toEqual({
                    size: createEvent.swarm.size - 1
                });
            });
        });

        describe("DELAY", () => {
            it("sets delayUntil to now() + 60 seconds if delayUntil is undefined", async () => {
                const delayEvent: MachineProvisionEvent = {
                    ...baseMachineProvisionEvent,
                    stepToExecute: MachineSetupStep.DELAY,
                    delayUntil: undefined
                };
                await setupHelpers.processMachineProvisionEvent(delayEvent);
                expect(enqueueStub.callCount).toBe(1);
                const enqueuedEvent: MachineProvisionEvent = enqueueStub.getCall(0).args[0];
                expect(enqueuedEvent.stepToExecute).toBe(MachineSetupStep.DELAY);
                const isAfter = moment(enqueuedEvent.delayUntil).isAfter(moment().add(55, "seconds"));
                expect(isAfter).toBe(true);
            });

            it("adds the delay step back into the queue at the end if we haven't reached the DELAY_UNTIL threshold", async () => {
                const delayEvent: MachineProvisionEvent = {
                    ...baseMachineProvisionEvent,
                    stepToExecute: MachineSetupStep.DELAY,
                    delayUntil: moment().add(15, "seconds").toDate()
                };
                await setupHelpers.processMachineProvisionEvent(delayEvent);
                expect(enqueueStub.callCount).toBe(1);
                const enqueuedEvent: MachineProvisionEvent = enqueueStub.getCall(0).args[0];
                expect(enqueuedEvent.stepToExecute).toBe(MachineSetupStep.DELAY);
                expect(enqueuedEvent.delayUntil).toEqual(delayEvent.delayUntil);
            });

            it("sets delayUntil to undefined if we no longer need to delay", async () => {
                const delayEvent: MachineProvisionEvent = {
                    ...baseMachineProvisionEvent,
                    stepToExecute: MachineSetupStep.DELAY,
                    delayUntil: moment().subtract(15, "seconds").toDate(),
                    steps: [
                        MachineSetupStep.MACHINE_READY
                    ]
                };
                await setupHelpers.processMachineProvisionEvent(delayEvent);
                expect(enqueueStub.callCount).toBe(1);
                const enqueuedEvent: MachineProvisionEvent = enqueueStub.getCall(0).args[0];
                expect(enqueuedEvent.stepToExecute).toBe(MachineSetupStep.MACHINE_READY);
                expect(enqueuedEvent.delayUntil).toBe(undefined);
            });
        });

        describe("MACHINE_READY", () => {
            it("sets the machine on the event if it is ready", async () => {
                const stubMachine: Machine.Machine = {
                    id: 1,
                    created_at: new Date(),
                    setup_complete: false,
                    file_transfer_complete: false,
                    is_master: false,
                    dependency_install_complete: false,
                    port_open_complete: false
                };
                const machineReadyStub = sandbox.stub(Machine, "isReady").resolves(true);
                sandbox.stub(Machine, "findById").resolves(stubMachine);
                const readyEvent: MachineProvisionEvent = {
                    ...baseMachineProvisionEvent,
                    stepToExecute: MachineSetupStep.MACHINE_READY
                };
                await setupHelpers.processMachineProvisionEvent(readyEvent);
                expect(enqueueStub.callCount).toBe(1);
                expect(machineReadyStub.callCount).toBe(1);
                const enqueuedEvent: MachineProvisionEvent = enqueueStub.getCall(0).args[0];
                expect(enqueuedEvent.machine).toEqual(stubMachine);

            });

            it("sleeps for 15 seconds if the machine is not ready and it should not deprovision", async () => {
                const machineReadyStub = sandbox.stub(Machine, "isReady").resolves(false);
                const shouldDeprovisionStub = sandbox.stub(Machine, "shouldDeprovision").resolves(false);
                const sleepStub: sinon.SinonStub = sandbox.stub(lib, "asyncSleep").resolves();
                const readyEvent: MachineProvisionEvent = {
                    ...baseMachineProvisionEvent,
                    stepToExecute: MachineSetupStep.MACHINE_READY
                };
                await setupHelpers.processMachineProvisionEvent(readyEvent);
                expect(enqueueStub.callCount).toBe(1);
                expect(machineReadyStub.callCount).toBe(1);
                expect(shouldDeprovisionStub.callCount).toBe(1);
                expect(sleepStub.getCall(0).args[0]).toBe(20);
                const enqueuedEvent: MachineProvisionEvent = enqueueStub.getCall(0).args[0];
                expect(enqueuedEvent.stepToExecute).toEqual(MachineSetupStep.MACHINE_READY);
            });

            // WIP -> Do these two tests then commit and move on.
            xit("removes the machine from the swarm and destroys the swarm if it was the last machine", async () => {

            });

            xit("removes the machine from the swarm and deprovisions the machine", async () => {

            });
        });

        describe("TRACEROUTE", () => {

        });

        describe("TRANSFER_FILE", () => {

        });

        describe("UNZIP_AND_PIP_INSTALL", () => {

        });
    });
});