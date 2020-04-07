const Promise = require('the-promise');
const _ = require('lodash');
const axios = require('axios');
const JobDampener = require('../utils/job-dampener');
const SnapshotReporter = require('./snapshot-reporter');
const HandledError = require('kubevious-helpers').HandledError;

class ReporterTarget
{
    constructor(logger, collector)
    {
        this._logger = logger.sublogger("ReporterTarget");
        this._snapshotLogger = logger.sublogger("SnapshotReporter");

        this._baseUrl = collector.url;
        this._axios = axios.create({
            baseURL: this._baseUrl,
            timeout: 10 * 1000,
        });

        this._jobDampener = new JobDampener(this._logger.sublogger("ReporterDampener"), this._processSnapshot.bind(this));

        this._latestSnapshot = null;
        this._latestSnapshotId = null;
    }

    get logger() {
        return this._logger;
    }

    report(snapshot)
    {
        this._logger.info("[report] date: %s, item count: %s", snapshot.date.toISOString(), snapshot.count);
        this._jobDampener.acceptJob(snapshot.date, snapshot);
    }

    _processSnapshot(date, snapshot)
    {
        this._logger.info("[_processSnapshot] date: %s, item count: %s", date.toISOString(), snapshot.count);
        return this._reportSnapshot(snapshot);
    }

    _reportSnapshot(snapshot)
    {
        this._logger.info("[_reportSnapshot] Begin");

        var snapshotReporter = new SnapshotReporter(this, this._snapshotLogger, snapshot, this._latestSnapshot, this._latestSnapshotId);
        return snapshotReporter.run()
            .then(() => {
                this._logger.info("[_reportSnapshot] Finished");

                if (snapshotReporter.isReported) {
                    this._latestSnapshot = snapshot;
                    this._latestSnapshotId = snapshotReporter.snapshotId;

                    this._logger.info("[_reportSnapshot] Completed. Latest Snapshot Id:", this._latestSnapshotId);
                } else {
                    this._latestSnapshot = null;
                    this._latestSnapshotId = null;

                    this._logger.warn("[_reportSnapshot] Failed to report. Will retry.");

                    return this._retrySnapshotReport(snapshot);
                }
            })
    }

    _retrySnapshotReport(snapshot)
    {
        return Promise.timeout(3000)
            .then(() => this._reportSnapshot(snapshot));
    }

    request(url, data)
    {
        this.logger.verbose("[request] url: %s%s", this._baseUrl, url);
        this.logger.silly("[request] url: %s%s, data: ", this._baseUrl, url, data);
        return this._axios.post(url, data)
            .then(res => {
                return res.data;
            })
            .catch(reason => {
                if (reason.response) {
                    this.logger.error('[request] URL: %s, RESPONSE STATUS: %s', url, reason.response.status)
                    if (reason.response.status == 413) {
                        var size = _.get(reason, 'request._redirectable._requestBodyLength');
                        this.logger.warn('[request] Request too big. Ingoring. URL: %s, Size: %s bytes', url, size)
                        return {};
                    } else {
                        throw new HandledError("HTTP Error " + reason.response.status);
                    }
                } else if (reason.request) {
                    this.logger.error('[request] URL: %s, ERROR: %s', url, reason.message)
                    throw new HandledError("Could not connect");
                } else {
                    this.logger.error('[request] URL: %s. Reason: ', url, reason)
                    throw new HandledError("Unknown error " + reason.message);
                }
                // throw reason;
            });
    }

}

module.exports = ReporterTarget;