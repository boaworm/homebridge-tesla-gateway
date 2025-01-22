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
    this.debug = config.debug || false;

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

    this.homebridgeService = new Service.Battery(this.name);
    this.homebridgeService.getCharacteristic(Characteristic.BatteryLevel)
        .setProps({
                    minValue: 0,
                    maxValue: 100
                })
        .on("get", this.getSensorReading.bind(this));

	this.homebridgeService.getCharacteristic(Characteristic.ChargingState)
		.setProps({
					minValue: 0,
					maxValue: 1
				})
        .on("get", this.getSensorReading.bind(this));

    /** @namespace config.pullInterval */
    if (config.pullInterval) {
        this.pullTimer = new PullTimer(log, config.pullInterval, this.getSensorReading.bind(this), value => {
			// Value should be 1,100
			this.log.info("Read this value from proxy:", value)
			let chargeStateValue = value.split(',')[0]
			this.log.info("Setting ChargingState to", chargeStateValue)
            this.homebridgeService.setCharacteristic(Characteristic.ChargingState, chargeStateValue);
			let batteryLevelValue = value.split(',')[1]
			let batteryLevelFloat = batteryLevelValue / 100
			this.log.info("Setting BatteryLevel to", batteryLevelValue)
            this.homebridgeService.setCharacteristic(Characteristic.BatteryLevel, batteryLevelValue);

        });
        this.pullTimer.start();
    }

    /** @namespace config.notificationPassword */
    /** @namespace config.notificationID */
    notifications.enqueueNotificationRegistrationIfDefined(api, log, config.notificationID, config.notificationPassword, this.handleNotification.bind(this));

    /** @namespace config.mqtt */
    if (config.mqtt) {
        let options;
        try {
            options = configParser.parseMQTTOptions(config.mqtt);
        } catch (error) {
            this.log.error("Error occurred while parsing MQTT property: " + error.message);
            this.log.error("MQTT will not be enabled!");
        }

        if (options) {
            try {
                this.mqttClient = new MQTTClient(this.homebridgeService, options, this.log);
                this.mqttClient.connect();
            } catch (error) {
                this.log.error("Error occurred creating MQTT client: " + error.message);
            }
        }
    }
}

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
        const characteristic = utils.getCharacteristic(this.homebridgeService, body.characteristic);
        if (!characteristic) {
            this.log("Encountered unknown characteristic when handling notification (or characteristic which wasn't added to the service): " + body.characteristic);
            return;
        }

        let value = body.value;
		/*
        if (body.characteristic === "CurrentStatus" && this.unit === TemperatureUnit.Fahrenheit)
            value = (value - 32) / 1.8;
		*/

        if (this.debug)
            this.log("Updating '" + body.characteristic + "' to new value: " + body.value);
        characteristic.updateValue(value);
    },

    getSensorReading: function (callback) {
        if (!this.statusCache.shouldQuery()) {
            const value = this.homebridgeService.getCharacteristic(Characteristic.BatteryLevel).value;
            if (this.debug)
                this.log(`getSensorReading() returning cached value ${value}${this.statusCache.isInfinite()? " (infinite cache)": ""}`);

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

                this.statusCache.queried();
                callback(null, sensorValue);
            }
        });
    },

};
