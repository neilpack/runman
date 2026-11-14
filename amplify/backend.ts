// Legacy Gen 2 reference only. DO NOT DEPLOY in AWS Academy Learner Lab:
// this path creates IAM/identity-pool resources beyond the approved lab setup.
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.js';
import { storage } from './storage/resource.js';

const backend = defineBackend({ auth, storage });

// RunMan requires an account for cloud access. Storage uses identity-scoped rules.
backend.auth.resources.cfnResources.cfnIdentityPool.allowUnauthenticatedIdentities = false;
