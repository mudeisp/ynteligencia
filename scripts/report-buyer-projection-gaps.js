#!/usr/bin/env node
const {cli}=require("./projection-reconciliation.js");
if(require.main===module)cli("report").then(code=>{process.exitCode=code;});
