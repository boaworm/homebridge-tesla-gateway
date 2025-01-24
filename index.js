"use strict";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";


let Service, Characteristic, api;

const _http_base = require("homebridge-http-base");
const http = _http_base.http;
const configParser = _http_base.configParser;
const PullTimer = _http_base.PullTimer;
const notifications = _http_base.notifications;
const MQTTClient = _http_base.MQTTClient;
const Cache = _http_base.Cache;
const utils = _http_base.utils;
const request = require('request')

var debug = require('debug')('homebridge-tesla-gateway');

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

	this.BatteryLevel = null;
	this.ChargingState = null;
	this.authToken = null;

	/*
	if(config.enableDebugLogging){
		this.log.info("Setting debug log to:", config.enableDebugLogging);
		if(config.enableDebugLogging == "true" || config.enableDebugLogging == 1){
			this.debug = true;
		}else{
			this.debug = false;
		}
	}
	*/

	this.log.info("Debug logging is set to:", this.debug);
	debug("This should be visible if debug is enabled...");

	this.pollingInterval = 150000; // Default, 2 and a half minutes...
	//
	if(config.pullInterval){
		this.log.info("Read \"pullInterval\" =",config.pullInterval," from config, applying");
		this.pollingInterval = config.pullInterval;
	}else{
		this.log.info("No \"pullInterval\" set - defaulting to ", this.pollingInterval);
	}
	
	if(config.gatewayPassword){
		this.gatewayPassword = config.gatewayPassword;
	}else{
		this.log.warn("gatewayPassword not set, will not be able to authenticate");
		this.log.warn("Aborting...");
		return;
	}

    if (config.getUrl) {
        try {
            this.getUrl = configParser.parseUrlProperty(config.getUrl);
        } catch (error) {
            this.log.warn("Error occurred while parsing 'getUrl': " + error.message);
            this.log.warn("Aborting...");
            return;
        }
    } else {
        this.log.warn("Property 'getUrl' is required!");
        this.log.warn("Aborting...");
        return;
    }

} // End of init function

HTTP_TESLA_GATEWAY.prototype = {

    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

	debugLog: function(message){
		if(this.debug){
			
		}
	},

	_getAuthenticateAsync: async function(){

		if(this.authToken != null){
			// Let's see how old it is
			let endTime = new Date();
			let timeDiff = endTime - this.tokenIssuedAtTime;
			timeDiff /= 1000;
			if( timeDiff > (30 * 60) ){
				this.log.info("Token is older than 30 minutes. Getting a new one");
			}else{
				this.log.info("Already have an auth token (starting with", this.authToken.substring(0,10), ". Not getting a new one yet");
				return this.authToken;
			}
		}

		// this.log.info("Entering _getAuthenticateAsync()");
		let myUrl = this.getUrl.url + "/login/Basic";
		this.log.info("Using URL:", myUrl);
		//const responsePromise = fetch(`${gatewayIp}/login/Basic`, {
try{
		// this.log.info("trying to log in with password", this.gatewayPassword);
		const responsePromise = fetch(myUrl, {
			method: 'POST',
			headers: {
				"Content-Type": "application/json",
			},  
			body: JSON.stringify({
				username: "customer",  // Tesla account username
				password: this.gatewayPassword,  // Tesla account password
			})  
		}); 

		return responsePromise
			.then( (responseData) => responseData.json())
			.then( (responseJson) => {
				this.authToken = responseJson.token;
				if(this.authToken != null){
					this.log.info("Got a token:", this.authToken.substring(0,10));
				}else{
					this.log.error("Tried to authenticate, but got null");
				}
				this.tokenIssuedAtTime = new Date();
				return this.authToken
			}); 	
}catch(error){
	this.log.error("xxx _getAuthenticateAsync exception:", error);
}
	},


    getServices: function () {
        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Henrik Thorburn")
            .setCharacteristic(Characteristic.Model, "HTTP Tesla Gateway")
            .setCharacteristic(Characteristic.SerialNumber, "BOA02")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

		this.BatteryService = new Service.BatteryService(this.name);
		this._getStatus(function(){});
		this._getAuthenticateAsync(async function(){});
		this._getStatusFromGateway(async function(){});
		this._getDataFromEndpointAsync(async function(serviceName){});
		this._getGridStatus(async function(){});
		this._getBatteryChargeLevel(async function(){});

		setInterval(function(){
			//this._getStatus(function() {})
			this._getStatusFromGateway(async function() {})
		}.bind(this), this.pollingInterval);

        return [informationService, this.BatteryService];
    },

	_httpRequest: function (url, callback){

		request({
			url: url,
			body: null,
			method: 'GET',
			timeout: this.timeout
		},
		function(error, response, body){
			callback(error, response, body)
		})

	},

	_getGridStatus: async function(){
		const body = await this._getDataFromEndpointAsync("system_status/grid_status");
		if(body==null){
			this.log.error("Got null when trying to get grid status");
			return "Undetermined";
		}else{
			return body.grid_status;
		}
	},

	_getBatteryChargeLevel: async function(){
		const body = await this._getDataFromEndpointAsync("/system_status/soe");
		if(body==null){
			this.log.error("Got null when trying to get battery level");
			return 0;
		}else{
			return body.percentage;
		}
	
	},

	_getDataFromEndpointAsync: async function(serviceName){
		if(this.authToken == null){
			this.log.error("No authToken - ignoring request to pull from ",serviceName);
			return null;
		}

		this.log.info("Getting data from endpoint",serviceName,"using authToken",this.authToken.substring(0,10),"...");
		let myUrl = this.getUrl.url + "/" + serviceName;
		const responsePromise = fetch(myUrl, {
			method: "GET",
			headers: {
				"Authorization": `Bearer ${this.authToken}`, // Use the auth token from login
			},
		});

		return responsePromise
			.then( (responseData) => responseData.json())
			.then( (responseJson) => {return responseJson});
	},

	// The "main" function
	_getStatusFromGateway: async function(callback){
		try{
			const token = await this._getAuthenticateAsync();
			this.log.info("*** Token", (token==null) ? "NULL" : token.substring(0,10), "...");

			if(token != null){

				const gridStatus = await this._getGridStatus();

				const gridStatusInt = (gridStatus=="SystemGridConnected") ? 1 : 0;
				this.log.info("*** Grid Status:", gridStatus, "/", gridStatusInt);

				const batteryLevel = Math.floor(await this._getBatteryChargeLevel());
				this.log.info("*** Battery Level:", batteryLevel);

				// MORE STUFF HERE !!!! 

				this.BatteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(batteryLevel);
				this.BatteryService.getCharacteristic(Characteristic.ChargingState).updateValue(gridStatusInt);

				if(batteryLevel <= 30){
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
				} else {
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
				}

				callback();


				// END OF MORE STUFF HERE !!!! 
			}else{
				this.log.error("No token - skipping fetching of status");
			}

		}catch(error){
			this.log.error("Exception:", error);
		}
	},

	_getStatus: function(callback){

		const url = this.getUrl.url;
		this.log.info("Processing with URL = ", url);

		this._httpRequest(url, function(error,response, responseBody){
			if(error){

				this.log.error("Error!");
				callback(error);
			}else{
				// this.log.info("Reponse = ", response); // lots of data here
				this.log.info("ResponseBody = ", responseBody);

				this.gridStatus = responseBody.split(',')[0];
				this.batteryLevel = responseBody.split(',')[1];

				this.log.info("Grid status = ", this.gridStatus);
				this.log.info("BatteryLevel = ", this.batteryLevel);

				// Let's do some random testing
				//this.gridStatus = Math.floor(Math.random() * 2);
				//this.batteryLevel = Math.floor(Math.random() * 100);

				this.BatteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(this.batteryLevel);
				this.BatteryService.getCharacteristic(Characteristic.ChargingState).updateValue(this.gridStatus);

				if(this.batteryLevel <= 30)
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
				else
					this.BatteryService.setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

				callback();
			}

		}.bind(this))
	}

};
