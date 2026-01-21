/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import express, {Request, Response} from "express";
import cors from "cors";

import {
  CollectRequest,
  TransactionStatus,
  CallbackRegistrationRequest, StatusCode, TransactionUpdate,
} from "./types";

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(cors({origin: true}));
app.use(express.json());

/**
 * POST /api/v2/transaction/updates
 * Receive a transaction payload and store it in Firestore
 */
app.post("/api/v2/transaction/updates", async (req: Request, res: Response) => {
  try {
    const body: TransactionUpdate = req.body;

    if (!body.order_id) {
      res.status(400).json({message: "Missing order_id"});
      return;
    }

    // Store the payload in transaction_updates collection
    // Document name should be order_id
    await db.collection("transaction_updates").doc(body.order_id).set(body);

    res.status(200).json({message: "Transaction update stored successfully"});
  } catch (error) {
    logger.error("Error in transaction updates endpoint", error);
    res.status(500).json({message: "Internal server error"});
  }
});

// Simple Auth Middleware
const authMiddleware = (
  req: Request,
  res: Response,
  next: () => void
) => {
  const authHeader = req.headers["authorization"];
  const xAuthHeader = req.headers["x-authorization"];

  if (!authHeader && !xAuthHeader) {
    res.status(401).json({
      statusCode: 285,
      message: "provided credentials are incorrect or inactive",
      clientId: null,
      services: null,
    });
    return;
  }
  next();
};

/**
 * POST /api/v2/transaction/updates
 * Receive a transaction payload and store it in Firestore
 */
app.post("/api/v2/transaction/updates", async (req: Request, res: Response) => {
  try {
    const body: TransactionUpdate = req.body;

    if (!body.order_id) {
      res.status(400).json({message: "Missing order_id"});
      return;
    }

    // Store the payload in transaction_updates collection
    // Document name should be order_id
    await db.collection("transaction_updates").doc(body.order_id).set(body);

    res.status(200).json({message: "Transaction update stored successfully"});
  } catch (error) {
    logger.error("Error in transaction updates endpoint", error);
    res.status(500).json({message: "Internal server error"});
  }
});

app.use(authMiddleware);

setGlobalOptions({maxInstances: 10});

/**
 * POST /api/v2/transaction/collect
 * Initiate an asynchronous collection request
 */
app.post("/api/v2/transaction/collect", async (req: Request, res: Response) => {
  try {
    const body: CollectRequest = req.body;

    // Basic validation
    if (
      !body.payer_number ||
      !body.external_reference ||
      !body.payment_narration ||
      !body.currency ||
      !body.amount
    ) {
      res.status(400).json({message: "Missing required fields"});
      return;
    }

    // Check for duplicate external_reference
    const duplicateDoc = await db.collection("transactions")
      .where("order_id", "==", body.external_reference)
      .limit(1)
      .get();

    if (!duplicateDoc.empty) {
      res.status(400).json({message: "Duplicate external id"});
      return;
    }

    // Generate a mock transaction_id
    const transactionId = "CCT" + Date.now().toString();

    // Determine final status based on query parameter
    const statusQuery = req.query.status;
    let finalStatus: StatusCode;

    if (statusQuery === "success") {
      finalStatus = {code: 300, message: "Transaction successful"};
    } else {
      finalStatus = {code: 301, message: "Transaction failed"};
    }

    // Prepare initial transaction status
    const transaction: TransactionStatus = {
      amount: body.amount,
      currency: body.currency,
      final_status: finalStatus.code,
      order_id: body.external_reference,
      transaction_id: transactionId,
      payer_number: body.payer_number,
      response_code: 202,
      response_message: finalStatus.message,
      account_number: body.account_number || "N/A",
      narration: body.payment_narration,
      callback_sent: false,
    };

    // Persist to Firestore
    await db.collection("transactions").doc(transactionId).set(transaction);

    res.status(202).json({
      message: "request received for processing successfully",
    });
  } catch (error) {
    logger.error("Error in collect endpoint", error);
    res.status(500).json({message: "Internal server error"});
  }
});

/**
 * GET /api/v2/transaction/fetch-status/{id}
 * Fetch status of a transaction by external reference id
 */
app.get(
  "/api/v2/transaction/fetch-status/:id",
  async (req: Request, res: Response) => {
    try {
      const externalId = req.params.id;

      const querySnapshot = await db.collection("transactions")
        .where("order_id", "==", externalId)
        .limit(1)
        .get();

      if (querySnapshot.empty) {
        res.status(404).json({message: "Not found"});
        return;
      }

      const transaction = querySnapshot.docs[0].data() as TransactionStatus;

      // Check if a callback has been sent
      if (!transaction.callback_sent) {
        res.status(404).json({message: "Not found"});
        return;
      }

      res.status(200).json(transaction);
    } catch (error) {
      logger.error("Error in fetch-status endpoint", error);
      res.status(500).json({message: "Internal server error"});
    }
  });

/**
 * POST /api/v2/callback/register.
 * Register a callback URL for transaction notifications
 */
app.post("/api/v2/callback/register", async (req: Request, res: Response) => {
  try {
    const body: CallbackRegistrationRequest = req.body;

    if (!body.callback_url) {
      res.status(400).json({message: "Missing callback_url"});
      return;
    }

    // Store the callback URL in Firestore.
    // For this mock, we'll use a fixed document ID "client_default".
    // Since we don't have a full client management system yet,
    // we'll store it under the "client_callbacks" collection.
    // To keep it simple as requested, we just store it.
    await db.collection("callbacks").doc("client_default").set({
      callback_url: body.callback_url,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({message: "Callback URL registered successfully"});
  } catch (error) {
    logger.error("Error in callback registration endpoint", error);
    res.status(500).json({message: "Internal server error"});
  }
});

/**
 * Firestore trigger: onDocumentCreated for transactions
 * Waits 1 minute and then calls the registered callback URL.
 */
export const onTransactionCreated = onDocumentCreated(
  "transactions/{transactionId}",
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.info("No data associated with the event");
      return;
    }

    const transactionData = snapshot.data();
    logger.info(
      `New transaction created: ${event.params.transactionId}. ` +
      "Waiting 1 minute before sending callback..."
    );

    // Wait for 15 seconds
    await new Promise((resolve) => setTimeout(resolve, 15000));

    try {
      // Get the registered callback URL
      const callbackDoc = await db
        .collection("callbacks")
        .doc("client_default")
        .get();
      if (!callbackDoc.exists) {
        logger.error("No callback URL registered");
        return;
      }

      const callbackUrl = callbackDoc.data()?.callback_url;
      if (!callbackUrl) {
        logger.error("Callback URL is empty");
        return;
      }

      logger.info(
        `Sending callback to ${callbackUrl} ` +
        `for transaction ${event.params.transactionId}`
      );

      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(transactionData),
      });

      if (response.ok) {
        logger.info(`Callback successfully sent to ${callbackUrl}`);
      } else {
        logger.error(
          `Failed to send callback to ${callbackUrl}. ` +
          `Status: ${response.status}`
        );
      }

      // Mark callback as sent in the transaction document
      await db.collection("transactions")
        .doc(event.params.transactionId)
        .update({callback_sent: true});
    } catch (error) {
      logger.error("Error sending callback", error);
    }
  });
export const api = onRequest({cors: false}, app);
