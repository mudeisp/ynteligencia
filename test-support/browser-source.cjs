const fs=require("node:fs");
const path=require("node:path");

// Tests exercise the scripts actually delivered by index, including the lazy detail.
// Nothing is fetched or executed here; keep source-based legacy fixtures usable.
module.exports=function browserSource(root=path.resolve(__dirname,"..")){
  const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const scripts=[...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map(match=>match[1]).filter(src=>!/^https?:\/\//.test(src))
    .map(src=>fs.readFileSync(path.join(root,src.split("?")[0]),"utf8"));
  scripts.push(fs.readFileSync(path.join(root,"assets/js/lazy/property-detail.js"),"utf8"));
  return [html,...scripts].join("\n");
};
