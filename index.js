"use strict";

let Service, Characteristic, api;

const _http_base = require("homebridge-http-base");
const http = _http_base.http;
const configParser = _http_base.configParser;
const PullTimer = _http_base.PullTimer;
const notifications = _http_base.notifications;
const MQTTClient = _http_base.MQTTClient;
const Cache = _http_base.Cache;
const utils = _http_base.utils;

const packageJSON = require("./package.json");

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    api = homebridge;

    homebridge.registerAccessory("homebridge-tesla-gateway", "HTTP-TESLA-GATEWAY", HTTP_TESLA_GATEWAY);
};

function HTTP_TESLA_GATEWAY(log, config) {
    this.log = log;
    this.name = config.name;
    this.debug = config.debug || true;

    if (config.getUrl) {
        try {
            this.getUrl = configParser.parseUrlProperty(config.getUrl);
        } catch (error) {
            this.log.warn("Error occurred while parsing 'getUrl': " + error.message);
            this.log.warn("Aborting...");
            return;
        }
    }
    else {
        this.log.warn("Property 'getUrl' is required!");
        this.log.warn("Aborting...");
        return;
    }

    this.statusCache = new Cache(config.statusCache, 0);
    this.statusPattern = /(\d,[0-9]{1,3})/;
    try {
        if (config.statusPattern)
            this.statusPattern = configParser.parsePattern(config.statusPattern);
    } catch (error) {
        this.log.warn("Property 'statusPattern' was given in an unsupported type. Using default one!");
    }
    this.patternGroupToExtract = 1;
    if (config.patternGroupToExtract) {
        if (typeof config.patternGroupToExtract === "number")
            this.patternGroupToExtract = config.patternGroupToExtract;
        else
            this.log.warn("Property 'patternGroupToExtract' must be a number! Using default value!");
    }

    this.homebridgeService = new Service.Battery(this.name, "Powerwall");
    let blc = this.homebridgeService.getCharacteristic(Characteristic.BatteryLevel);
    blc.setProps({ minValue: 0, maxValue: 100 });
    blc.on("get", this.getSensorReading.bind(this));

	let csc = this.homebridgeService.getCharacteristic(Characteristic.ChargingState);
	csc.setProps({ minValue: 0, maxValue: 1 });
    csc.on("get", this.getSensorReading.bind(this));

    /** @namespace config.pullInterval */
    if (config.pullInterval) {
        this.pullTimer = new PullTimer(log, config.pullInterval, this.getSensorReading.bind(this), value => {
			// Value should be 1,100
			this.log.info("Read this value from web proxy:", value)


			let chargeStateValue = value.split(',')[0]
			if(!csc)
				log.error("Unable to get ChargingLevel characteristic")
			else{
				const x = Math.floor(Math.random() * 2);
				csc.updateValue(x)
				this.log.info("Set ChargingLevel to ", x);
				//csc.updateValue(chargeStateValue)
			}

			let batteryLevelValue = value.split(',')[1]
			this.log.info("Received BatteryLevel [", batteryLevelValue, "] from gateway");
			let batteryLevelFloat = (batteryLevelValue / 100) - 0.01;
			if(batteryLevelFloat <= 0.01)
				batteryLevelFoat = 0.01
			this.log.info("Setting BatteryLevel to", batteryLevelFloat)


            //this.homebridgeService.setCharacteristic(Characteristic.BatteryLevel, batteryLevelValue);
			//const blc = utils.getCharacteristic(this.homebridgeService, Characteristic.BatteryLevel);
			if(!blc)
				log.error("Unable to get BatteryLevel characteristic");
			else
				blc.updateValue(batteryLevelValue)

        });
        this.pullTimer.start();
    }

    notifications.enqueueNotificationRegistrationIfDefined(api, log, config.notificationID, config.notificationPassword, this.handleNotification.bind(this));

} // End of init function

HTTP_TESLA_GATEWAY.prototype = {

    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

    getServices: function () {
        if (!this.homebridgeService)
            return [];

        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Henrik Thorburn")
            .setCharacteristic(Characteristic.Model, "HTTP Tesla Gateway")
            .setCharacteristic(Characteristic.SerialNumber, "BOA02")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

        return [informationService, this.homebridgeService];
    },

    handleNotification: function(body) {
		this.info.log("handleNotification()");
        const characteristic = utils.getCharacteristic(this.homebridgeService, body.characteristic);
        if (!characteristic) {
            this.log("Encountered unknown characteristic when handling notification (or characteristic which wasn't added to the service): " + body.characteristic);
            return;
        }

        let value = body.value;
		this.log.info("Received update for characteristic [", body.characteristic, "] = [", body.value, "]");
		this.info.log("Updating '" + body.characteristic + "' to new value: " + body.value);
        characteristic.updateValue(value);
    },

    getSensorReading: function (callback) {
        if (!this.statusCache.shouldQuery()) {
			this.log.info("Returning cached values rather than pulling fresh data")
			
			const x1 = this.homebridgeService.getCharacteristic(Characteristic.ChargingState).value;

			const x2 = this.homebridgeService.getCharacteristic(Characteristic.BatteryLevel).value;

			const value = str(x1) + "," + str(x2);

            if (this.debug)
                this.log(`getSensorReading() returning cached value ${value}${this.statusCache.isInfinite()? " (infinite cache)": ""}`);

			log.info("Returning value [", value, "] from cache")
            callback(null, value);
            return;
        }

        http.httpRequest(this.getUrl, (error, response, body) => {
            if (this.pullTimer)
                this.pullTimer.resetTimer();

            if (error) {
                this.log("getSensorReading() failed: %s", error.message);
                callback(error);
            }
            else if (!http.isHttpSuccessCode(response.statusCode)) {
                this.log("getSensorReading() returned http error: %s", response.statusCode);
                callback(new Error("Got http error code " + response.statusCode));
            }
            else {
                let sensorValue;
                try {
                    sensorValue = utils.extractValueFromPattern(this.statusPattern, body, this.patternGroupToExtract);
                } catch (error) {
                    this.log("getSensorReading() error occurred while extracting status from body: " + error.message);
                    callback(new Error("pattern error"));
                    return;
                }

                if (this.debug)
                    this.log("Status is currently at %s", sensorValue);

				this.log.info("Retrieved [", sensorValue, "] from proxy service")
                this.statusCache.queried();
                callback(null, sensorValue);
            }
        });
    },

};
