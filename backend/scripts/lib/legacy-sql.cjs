'use strict';
const {sqlValues}=require('../migrate-legacy-store-accounts.cjs');
/** Read a named table from the existing local dump without executing its SQL. */
function tableRows(sql,table) {
  if(!/^[a-z_]+$/.test(table))throw new Error('Invalid source table');
  const create=sql.match(new RegExp('CREATE TABLE `'+table+'`\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE'));
  if(!create)throw new Error('Missing source table '+table);
  const columns=[...create[1].matchAll(/^\s*`([^`]+)`/gm)].map(match=>match[1]);
  const prefix='INSERT INTO `'+table+'` VALUES ';
  const rows=[];
  for(const line of sql.split(/\r?\n/))if(line.startsWith(prefix))for(const values of sqlValues(line.slice(prefix.length).replace(/;\s*$/,''))) {
    if(values.length!==columns.length)throw new Error('Source column mismatch for '+table);
    rows.push(Object.fromEntries(columns.map((column,i)=>[column,values[i]])));
  }
  return rows;
}
module.exports={tableRows};
