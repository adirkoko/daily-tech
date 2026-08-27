/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    adminSession: import("./server/auth.js").AuthenticatedAdminSession | null;
  }
}
