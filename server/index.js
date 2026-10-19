'use strict';
/*
 * Image & video studio: pictures and videos from a description, with the provider chosen in Hostwerk's AI helper, the
 * monthly budget and the media library.
 */
const { Studio } = require('./studio');

exports.activate = (host) => {
  const studio = new Studio(host);
  studio.routes(host.router);
};

exports.deactivate = () => {};
