import { routerHealth } from "@controllers/health/health_controller.js";
import { routerDoc } from "@controllers/doc/doc_controller.js";
import { routerMetrics } from "@controllers/profile/metrics_controller.js";
import { routerProfile } from "@controllers/profile/profile_controller.js";
import express from "express";
import { app } from "../../app.js";

export const init_routes = () => {
    app.use(express.json());
    app.use("/health", routerHealth);
    app.use("/doc", routerDoc);
    app.use("/profile", routerMetrics);
    app.use("/metrics", routerProfile);
}