#!/usr/bin/env node
const {cli}=require("./projection-reconciliation.js");
if(require.main===module)cli("profile").then(code=>{process.exitCode=code;});
