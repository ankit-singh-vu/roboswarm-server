// import * as Stripe from "stripe";
import { Stripe } from "stripe";
import * as User from "../models/User";

// const config: Stripe.StripeConfig = {
//     apiVersion: "2020-08-27",
//     typescript: true
// };

const config: any = {
    apiVersion: "2020-08-27",
    typescript: true
};

const stripePlans: any = {
    development: {
        free: "plan_DsOgBFnxs3q0Fu",
        startup: "plan_DsOgpbf6qZDIYc",
        enterprise: "plan_DsOhDhHNxMpAYi",
        "2020-roboswarm-free": "price_1GwX0hHYMGm9MgfZWNiWCtNB",
        "2020-roboswarm-startup": "price_1GwX11HYMGm9MgfZTmNxIU5H",
        "2020-roboswarm-enterprise": "price_1GwX1NHYMGm9MgfZNkJq7X0o"
    },
    production: {
        free: "plan_DsOd6cJgabydY8",
        startup: "plan_DvRC4jdEGKYKZJ",
        enterprise: "plan_DvRCm2UAaidwN5",
        "2020-roboswarm-free": "price_1GwWx3HYMGm9MgfZf6OMt4xZ",
        "2020-roboswarm-startup": "price_1GwWyAHYMGm9MgfZkfXUFmUb",
        "2020-roboswarm-enterprise": "price_1GwWykHYMGm9MgfZwpx3V95h"
    }
};

function getPlanId(planName: string): string {
    if (process.env.NODE_ENV === "development") {
        return stripePlans.development[planName];
    } else {
        return stripePlans.production[planName];
    }
}

export async function createStripeCustomer(user: User.User): Promise<void> {
    const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    const customerOptions: Stripe.CustomerCreateParams = {
        email: user.email,
        description: `${user.first_name} ${user.last_name}`
    };
    const newCustomer: Stripe.Customer = await stripe.customers.create(customerOptions);
    await User.updateById(user.id, { stripe_id: newCustomer.id });
}

export async function getUserSubscription(user: User.User): Promise<Stripe.Subscription> {
    const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    const subscriptionListOptions: Stripe.SubscriptionListParams = {
        customer: user.stripe_id
    };
    const subscriptions: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list(subscriptionListOptions);
    return subscriptions.data[0];
}

export async function setStripePlan(userId: number, planName: string): Promise<void> {
    // const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    const user: User.User = await User.getById(userId);
    // const subscriptionListOptions: Stripe.SubscriptionListParams = {
    //     customer: user.stripe_id
    // };
    // const subscriptions: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list(subscriptionListOptions);

    // User has an existing plan. Update it.
    // if (subscriptions.data.length > 0) {
    //     const subscription: Stripe.Subscription = await stripe.subscriptions.retrieve(subscriptions.data[0].id);
    //     const updateOptions: Stripe.SubscriptionUpdateParams = {
    //         cancel_at_period_end: false,
    //         items: [{
    //             id: subscription.items.data[0].id,
    //             plan: getPlanId(planName)
    //         }]
    //     };
    //     await stripe.subscriptions.update(subscription.id, updateOptions);

    // // User does not yet have a plan, create subscription.
    // } else {
    //     const createOptions: Stripe.SubscriptionCreateParams = {
    //         customer: user.stripe_id,
    //         items: [{ plan: getPlanId(planName) }]
    //     };
    //     await stripe.subscriptions.create(createOptions);
    // }

    // Store the planId and planDescription with the user.
    await User.updateById(user.id, {
        stripe_plan_id: getPlanId(planName),
        stripe_plan_description: planName
    });

    console.log("planName", planName)
    console.log("User", User)
}

export async function addCardToCustomer(userId: number, token: string, cardId: string): Promise<void> {
    const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    const user: User.User = await User.getById(userId);
    const options: Stripe.CustomerUpdateParams = { source: token };
    await stripe.customers.update(user.stripe_id, options);
    await User.updateById(userId, { stripe_card_id: cardId });
}

export async function deleteCardFromCustomer(userId: number): Promise<void> {
    const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    const user: User.User = await User.getById(userId);
    await stripe.customers.deleteSource(user.stripe_id, user.stripe_card_id);
}

export async function getCustomer(userId: number): Promise<Stripe.Customer|Stripe.DeletedCustomer> {
    const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    const user: User.User = await User.getById(userId);
    return await stripe.customers.retrieve(user.stripe_id);
}

export async function getInvoices(userId: number): Promise<Stripe.ApiList<Stripe.Invoice>> {
    const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    const user: User.User = await User.getById(userId);
    return await stripe.invoices.list({
        customer: user.stripe_id,
        limit: 10
    });
}

export async function payInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const stripe = new Stripe(process.env.ROBOSWARM__STRIPE_API_SECRET, config);
    return await stripe.invoices.pay(invoiceId);
}