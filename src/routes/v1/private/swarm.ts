import { Router } from "express";
import * as Swarm from "../../../models/Swarm";
import * as Machine from "../../../models/Machine";
import * as SwarmMachine from "../../../models/SwarmMachine";
import * as LoadTest from "../../../models/LoadTest";
import * as LoadTestError from "../../../models/LoadTestError";
import * as User from "../../../models/User";
import * as SiteOwnership from "../../../models/SiteOwnership";
import * as SwarmRouteCache from "../../../models/SwarmRouteCache";
import { RoboRequest, RoboResponse, RoboError } from "../../../interfaces/shared.interface";
import { canCreateSwarm } from "../../../lib/authorization";
import * as multer from "multer";
import * as LoadTestFile from "../../../models/LoadTestFile";
import { LoadTestRouteSpecificData, getRoutes } from "../../../models/LoadTestRouteSpecificData";
import { isEventQueueAvailable } from "../../../lib/events";

interface NewSwarmRequest extends RoboRequest {
    body: Swarm.NewSwarm;
}

interface LoadTestMetrics {
    requests: LoadTest.Request[];
    distribution: LoadTest.Distribution[];
    errors: LoadTestError.LoadTestError[];
}

interface LoadTestMetricsQuery {
    lastDistributionId: number;
    lastRequestId: number;
    showAll: boolean;
}

interface LoadTestMetricsResponse extends RoboResponse {
    json: (metrics: LoadTestMetrics) => any;
}

interface LoadTestRouteSpecificMetricsResponse extends RoboResponse {
    json: (metrics: LoadTestRouteSpecificData[]) => any;
}

interface LoadTestMetricsRequest extends RoboRequest {
    body: LoadTestMetricsQuery;
}

interface LoadTestRouteSpecificMetricsRequest extends RoboRequest {
    body: {
        showAll: boolean;
        lastRowId: number;
        route: string;
    };
}

interface RepeatSwarmResponse extends RoboResponse {
    json: (newSwarm: Swarm.Swarm) => any;
}

interface IPAddress {
    ip_address: string;
    traceroute: string;
}

interface LoadTestIpAddressesResponse extends RoboResponse {
    json: (ips: IPAddress[]) => any;
}

interface SwarmListRequest extends RoboRequest {
    query: {
        page?: string;
    };
}

interface TimeRemaining {
    timeInSeconds: number;
}

interface TimeRemainingResponse extends RoboResponse {
    json: (time: TimeRemaining) => any;
}

interface SwarmRouteResponse extends RoboResponse {
    json: (routes: string[]) => any;
}

const router = Router();

router.route("/:id/metrics/final")
    .get(async (req: LoadTestMetricsRequest, res: LoadTestMetricsResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        const [ requests, distribution ] = await Promise.all([
            LoadTest.getRequestsFinal(id),
            LoadTest.getDistributionFinal(id)
        ]);
        const errors: LoadTestError.LoadTestError[] = await LoadTestError.getBySwarmId(id);
        res.status(200);
        res.json({
            requests,
            distribution,
            errors
        });
    });

router.route("/:id/metrics/route-specific")
    .post(async (req: LoadTestRouteSpecificMetricsRequest, res: LoadTestRouteSpecificMetricsResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        try {
            const totalRows = await LoadTest.getTotalRouteSpecificRows(id, req.body.route, req.body.lastRowId);
            const rowsBetweenPoints = req.body.showAll ? 1 : LoadTest.getRowsInBetweenPoints(totalRows);
            const data = await LoadTest.getRouteSpecificInRange(id, req.body.route, rowsBetweenPoints, req.body.lastRowId);
            res.status(200);
            res.json(data);
        } catch (err) {
            res.status(500);
            res.json(err);
        }
    });

router.route("/:id/metrics")
    .post(async (req: LoadTestMetricsRequest, res: LoadTestMetricsResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        try {
            const totalRequestRows = await LoadTest.getTotalRequestRows(id, req.body.lastRequestId);
            const [ requests, distribution, errors ] = await Promise.all([
                LoadTest.getRequestsAndFailuresInRange(id, totalRequestRows, req.body?.lastRequestId),
                LoadTest.getLatestDistribution(id),
                LoadTestError.getBySwarmId(id)
            ]);
            res.status(200);
            res.json({
                requests,
                distribution,
                errors
            });
        } catch (err) {
            res.status(500);
            res.json(err);
        }
    });

router.route("/:id/ip-addresses")
    .get(async (req: RoboRequest, res: LoadTestIpAddressesResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        const machines: Machine.Machine[] = await SwarmMachine.getSwarmMachines(id);
        const ips: IPAddress[] = machines
            .filter(m => !m.is_master)
            .map(m => {
                return {
                    ip_address: m.ip_address,
                    traceroute: m.traceroute
                };
            });
        res.status(200);
        res.json(ips);
    });

router.route("/:id/repeat")
    .post(async (req: RoboRequest, res: RepeatSwarmResponse) => {
        // Alway check if the event queue is available.
        if (!isEventQueueAvailable()) {
            res.status(500);
            res.send("The event queue system is offline. Please try again later.");
            return;
        }

        // Validate ownership of swarm.
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        const newSwarm: Swarm.NewSwarm = await Swarm.createRepeatSwarmRequest(id);
        const user: User.User = await User.getById(req.auth.id);
        const isReliabilityTest = !!(newSwarm.simulated_users <= 25 && newSwarm.duration > 120);
        newSwarm.site_id = await SiteOwnership.getSiteIdByBaseUrl(newSwarm.host_url, user.id, user.group.id) as number;
        // const canProceed: boolean | RoboError = await canCreateSwarm(user, newSwarm, isReliabilityTest);
        const canProceed: boolean | RoboError = true;
        if (canProceed !== true) {
            const err = canProceed as RoboError;
            res.status(err.status);
            res.send(err.err);
        } else {
            try {
                const mySwarm: Swarm.Swarm = await Swarm.create(newSwarm, req.auth.id, req.auth.groupId, true);
                const ltFile: LoadTestFile.LoadTestFile = await LoadTestFile.getBySwarmId(swarm.id);
                await LoadTestFile.create({
                    swarm_id: mySwarm.id,
                    lt_file: ltFile.lt_file
                });
                res.status(201);
                res.json(mySwarm);
            } catch (err) {
                res.status(500);
                res.send("There was an error creating your new swarm.");
            }
        }
    });

router.route("/:id/soft-delete")
    .delete(async (req: RoboRequest, res: RoboResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        try {
            await Swarm.softDelete(id, req.auth.groupId);
            res.status(204);
            res.send("ok");
        } catch (err) {
            res.status(500);
            res.json(err);
        }
    });

router.route("/:id/time-remaining")
    .get(async (req: RoboRequest, res: TimeRemainingResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const timeInSeconds = await Swarm.getAverageTimeToCreationRemainingInSeconds(id);
        res.status(200);
        res.json({ timeInSeconds });
    });

router.route("/:id/routes")
    .get(async (req: RoboRequest, res: SwarmRouteResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const routeCache = await SwarmRouteCache.get(id);
        if (routeCache) {
            res.status(200);
            res.json(routeCache.routes);
        } else {
            const routes = await getRoutes(id);
            await SwarmRouteCache.create(id, routes);
            res.status(200);
            res.json(routes);
        }
    });

router.route("/:id")
    .delete(async (req: RoboRequest, res: RoboResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        try {
            await Swarm.destroyById(id, req.auth.groupId);
            res.status(204);
            res.send("ok");
        } catch (err) {
            res.status(500);
            res.json(err);
        }
    })
    .get(async (req: RoboRequest, res: RoboResponse) => {
        const id: number = parseInt(req.params.id, 10);
        const swarm: Swarm.Swarm = await Swarm.getById(id);
        if (swarm.group_id !== req.auth.groupId) {
            res.status(401);
            res.send("Unauthorized.");
            return;
        }
        try {
            const swarm: Swarm.Swarm = await Swarm.getById(id);
            res.status(200);
            res.json(swarm);
        } catch (err) {
            res.status(500);
            res.json(err);
        }
    });

router.route("/")
    .get(async (req: SwarmListRequest, res: RoboResponse) => {
        const page: number = req.query.page ? Number(req.query.page) : undefined;
        const swarms: Array<Swarm.Swarm> = await Swarm.getByGroupId(req.auth.groupId, page);
        const totalSwarms: number = await Swarm.getCountByGroupId(req.auth.groupId);
        res.set("Access-Control-Expose-Headers", "X-TOTAL-SWARMS,X-PAGE-SIZE");
        res.set("X-TOTAL-SWARMS", totalSwarms.toString());
        res.set("X-PAGE-SIZE", "12");
        res.status(200);
        res.json(swarms);
    })
    .post(async (req: NewSwarmRequest, res: RoboResponse) => {
        console.log("inside Creating new swarm");

        // Alway check if the event queue is available.
        if (!isEventQueueAvailable()) {
            res.status(500);
            res.send("The event queue system is offline. Please try again later.");
            return;
        }

        // Always add one machine to the pool so it can be master.
        req.body.machines.push({ region: req.body.machines[0].region });
        const user: User.User = await User.getById(req.auth.id);
        // const canProceed: boolean|RoboError = await canCreateSwarm(user, req.body, req.body.reliability_test);
        const canProceed: boolean | RoboError = true;
        if (canProceed !== true) {
            console.log("inside if canProceed");
            const err = canProceed as RoboError;
            res.status(err.status);
            res.send(err.err);
        } else {
            try {
                console.log("inside else canProceed");
                const mySwarm: Swarm.Swarm = await Swarm.create(req.body, req.auth.id, req.auth.groupId, false);
                res.status(201);
                res.json(mySwarm);
            } catch (err) {
                console.error(err);
            }
        }
    });

export default router;
