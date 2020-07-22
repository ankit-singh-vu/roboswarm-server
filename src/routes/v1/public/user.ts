import * as express from "express";
import * as User from "../../../models/User";
import * as Stripe from "../../../lib/stripe";
import * as PasswordResetNonce from "../../../models/PasswordResetNonce";
import {
    getUserToken,
    isValidAuthBody,
    isValidUserBody
} from "../../../lib/userHelpers";
import { TokenizedUser } from "../../../interfaces/shared.interface";
import { sendEmail, sendRegistrationEmail, sendPasswordResetEmail } from "../../../lib/email";

interface PasswordResetRequest extends express.Request {
    body: {
        email: string;
    };
}

interface ChangePasswordRequest extends express.Request {
    body: {
        password: string;
    };
    params: {
        nonce: string;
    };
}

const router = express.Router();

router.route("/")
    .post(async (req: express.Request, res: express.Response) => {
        if (!isValidUserBody(req.body)) {
            res.status(400);
            res.send("Invalid request. email, first_name, last_name, and password fields are required.");
            return;
        }

        if (await User.exists(req.body.email)) {
            res.status(400);
            res.send("A user already exists with that email address.");
            return;
        }

        try {
            const newUser: User.User = await User.createUser(req.body);
            const tokenUser: TokenizedUser = {
                id: newUser.id,
                groupId: newUser.group.id,
                email: newUser.email
            };
            await Stripe.createStripeCustomer(newUser);
            await Stripe.setStripePlan(newUser.id, "2020-roboswarm-free");
            sendEmail({
                to: "jack@kernl.us",
                from: "jack@kernl.us",
                subject: `A new RoboSwarm user has signed up: ${newUser.email}`,
                text: `${newUser.first_name} ${newUser.last_name} (${newUser.email})`
            });
            sendRegistrationEmail(newUser);
            res.status(201);
            res.json({
                token: getUserToken(tokenUser),
                user: newUser,
            });
        } catch (err) {
            res.status(500);
            res.json({
                message: "There was an error creating your user.",
                err: err.toString()
            });
        }
    });

router.route("/auth")
    .post(async (req: express.Request, res: express.Response) => {
        if (!isValidAuthBody(req.body)) {
            res.status(400);
            res.send("Invalid request. email and password fields are required.");
            return;
        }

        const valid = await User.authenticate(req.body.email, req.body.password);
        if (!valid) {
            res.status(400);
            res.send("Invalid email or password.");
        } else {
            const authenticatedUser = await User.getByEmail(req.body.email);
            res.status(200);
            res.json(getUserToken({
                id: authenticatedUser.id,
                groupId: authenticatedUser.group.id,
                email: authenticatedUser.email
            }));
        }
    });

router.route("/password-reset/:nonce")
    .post(async (req: ChangePasswordRequest, res: express.Response) => {
        try {
            const userNonce: PasswordResetNonce.PasswordResetNonce = await PasswordResetNonce.getByNonce(req.params.nonce);
            await User.changePassword(userNonce.user_id, req.body.password);
            await PasswordResetNonce.invalidate(userNonce.id);
            res.status(200);
            res.send("OK");
        } catch (err) {
            res.status(500);
            res.send("There was an error changing your password.");
        }
    });

router.route("/password-reset")
    .post(async (req: PasswordResetRequest, res: express.Response) => {
        try {
            const user: User.User = await User.getByEmail(req.body.email);
            const nonce: PasswordResetNonce.PasswordResetNonce = await PasswordResetNonce.create(user.id);
            sendPasswordResetEmail(user.email, nonce.nonce);
        } catch (err) { /* no-op */ }
        res.status(200);
        res.send("ok");
    });

export default router;
