import * as moment from "moment";
import { User } from "../models/User";
import * as stripeHelpers from "./stripe";
import * as Stripe from "stripe";
import * as Swarm from "../models/Swarm";
import { getPlan } from "./config";
import { RoboError } from "../interfaces/shared.interface";
import * as SiteOwnership from "../models/SiteOwnership";

export const unlimitedMaxDurationUsers: string[] = ["tom@convesio.com"];

export interface DateRange {
    start: Date;
    end: Date;
}

export interface ResourceAvailability {
    resetsOnDate: Date;
    delinquent: boolean;
    loadTests: number;
    machineSeconds: number;
    maxDurationMinutes: number;
    maxLoadTests: number;
    maxMachineSeconds: number;
}

export async function getAuthorizationDateRange(user: User): Promise<DateRange> {
    const subscription: Stripe.Stripe.Subscription = await stripeHelpers.getUserSubscription(user);
    return {
        start: moment.unix(subscription.current_period_start).toDate(),
        end: moment.unix(subscription.current_period_end).toDate()
    };
}

export async function willExceedMaxMachineHours(user: User, testDurationInMinutes: number): Promise<boolean> {
    const queryDateRange: DateRange = await getAuthorizationDateRange(user);
    const total: number = await Swarm.totalMachineSecondsInPeriod(queryDateRange.start, queryDateRange.end, user.group.id);
    const maxAllowedMachineSeconds: number = getPlan(user).maxMachineHours * 60 * 60;
    const testDurationInSeconds = testDurationInMinutes * 60;
    return ((total + testDurationInSeconds) > maxAllowedMachineSeconds);
}

export async function willExceedMaxLoadTests(user: User): Promise<boolean> {
    const queryDateRange: DateRange = await getAuthorizationDateRange(user);
    const swarmsInRange: number = await Swarm.getSwarmsInDateRange(queryDateRange.start, queryDateRange.end, user.group.id);
    const maxLoadTests: number = getPlan(user).maxLoadTests;
    return swarmsInRange < maxLoadTests ? false : true;
}

export function willExceedMaxLoadTestDuration(user: User, proposedSwarmDuration: number, isReliabilityTest: boolean): boolean {
    // Exception for trusted customers who want to run long tests.
    if (unlimitedMaxDurationUsers.includes(user.email)) {
        return false;
    }
    const plan = getPlan(user);
    if (isReliabilityTest) {
        return proposedSwarmDuration > plan.maxReliabilityTestMinutes;
    } else {
        return proposedSwarmDuration > plan.maxLoadTestDurationMinutes;
    }
}

export function willExceedMaxUsers(user: User, requestedUsers: number, isReliabilityTest: boolean): boolean {
    const plan = getPlan(user);
    if (isReliabilityTest) {
        return requestedUsers > plan.maxReliabilityTestUsers;
    } else {
        return requestedUsers > plan.maxUsers;
    }
}

export async function isValidSite(user: User, swarm: Swarm.NewSwarm): Promise<boolean> {
    // return true;
    // Check site id against current user.
    if (!swarm.site_id) return false;
    const siteOwnership: SiteOwnership.SiteOwnership = await SiteOwnership.findById(swarm.site_id);
    if (siteOwnership.user_id !== user.id) {
        return false;
    }

    // Site is only valid for testing if it is verified.
    return siteOwnership.verified;
}

export async function canCreateSwarm(user: User, swarm: Swarm.NewSwarm, isReliabilityTest: boolean): Promise<RoboError|boolean> {
    try {
        const numberOfMachinesToCreate: number = Math.ceil(swarm.machines.length / 2);
        let isValid = await isValidSite(user, swarm);
        console.log("isValidSite", isValid);
        // if (!(await isValidSite(user, swarm))) {
        if (!(isValid)) {
            return {
                err: "The site has not been verified. If your load test is for more than 5 simulated users, you must verify your ownership of the site. Please verify your site and try again. If you have already verified your site, please contact support.",
                status: 400
            };
        }

        if (await Swarm.willExceedDropletPoolAvailability(numberOfMachinesToCreate)) {
            return {
                err: "This request will exceed the resources that RoboSwarm has available. Our team has been notified.",
                status: 500
            };
        }

        const swarmMachineMinutes: number = swarm.duration * numberOfMachinesToCreate;
        if (await willExceedMaxMachineHours(user, swarmMachineMinutes)) {
            return {
                err: "This request will exceed the number of hours you have left on your plan before your next billing cycle. Try a smaller swarm size.",
                status: 403
            };
        }

        if (await willExceedMaxLoadTests(user)) {
            return {
                err: "This request will exceed the maximum number of load tests that your plan allows.",
                status: 403
            };
        }

        if (await willExceedMaxLoadTestDuration(user, swarm.duration, isReliabilityTest)) {
            return {
                err: "This request will exceed the maximum load test duration for your account. Please try again with a shorter duration.",
                status: 403
            };
        }

        if (await willExceedMaxUsers(user, swarm.simulated_users, isReliabilityTest)) {
            const maxUsers = getPlan(user).maxUsers;
            return {
                err: `This request will exceed the maximum number of users (${maxUsers}) allowed by your account. To run a larger load test, upgrade to a bigger plan.`,
                status: 403
            };
        }

        if (user.is_delinquent) {
            return {
                err: "This account is past due. You cannot create swarms while your account is past due.",
                status: 402
            };
        }

        return true;
    } catch (err) {
        console.error("error in canCreateSwarm", err);

        return {
            err: "There was error verifying your account status.",
            status: 500
        };
    }
}

export async function getUserResourceAvailability(user: User): Promise<ResourceAvailability> {
    const queryDateRange: DateRange = await getAuthorizationDateRange(user);
    const swarmsInRange: number = await Swarm.getSwarmsInDateRange(queryDateRange.start, queryDateRange.end, user.group.id);
    const maxLoadTests: number = getPlan(user).maxLoadTests;
    const totalMachineSeconds: number = await Swarm.totalMachineSecondsInPeriod(queryDateRange.start, queryDateRange.end, user.group.id);
    const maxAllowedMachineSeconds: number = getPlan(user).maxMachineHours * 60 * 60;
    return {
        resetsOnDate: queryDateRange.end,
        delinquent: user.is_delinquent,
        loadTests: swarmsInRange,
        maxLoadTests: maxLoadTests,
        machineSeconds: Math.floor(totalMachineSeconds),
        maxMachineSeconds: maxAllowedMachineSeconds,
        maxDurationMinutes: getPlan(user).maxLoadTestDurationMinutes,
    };

}