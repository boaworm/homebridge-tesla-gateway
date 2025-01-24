# homebridge-tesla-gateway Plugin

This [Homebridge](https://github.com/nfarina/homebridge) plugin can be used to display various Tesla Gateway data points in HomeKit. It treats the Gateway as a Battery.
BatteryLevel = Total charge in connected Powerwalls combined
ChargingState = Is it pulling from the grid or not (1=Grid online. 0=Grid OFFLINE)

This plugin authenticates and connects directly to the LAN interface of the Gateway, using the "customer/<password>" setup.

Please note that this is inspired by two projects:

dhop90's [esp8266](https://github.com/dhop90/homebridge-http-esp8266-battery) battery stuff, and 

Supereg's [homebridge-http-temperature-sensor](https://github.com/Supereg/homebridge-http-temperature-sensor)

With some modifications
1) Making it specific to Tesla Gateway (rather than battery or temp sensors)
2) Authentication to Tesla Gateway API
3) 30 minute token refresh (hardcoded for now)
4) Reuse of token


Currently, the following is hardcoded into the plugin:

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

It is needed as the Gateway has a self-signed SSL Certificate. I tried setting it in runtime, but it was too late. I also tried to rely on the default strictSSL = false option in the config, but it does not work. Future versons could correct this.

Future enhancements could be:
1) More and improved error handling. If the token gets invalidated, the plugins will fail for the next 30-sh minutes. 
2) More sensor readings
3) Graceful handling if connection is lost for some time (should we retain last values, set some default, ...)
4) See if the "strictSSL" setting could be used to bypass the hardcoded SSL disabling

## Installation

First of all you need to have [Homebridge](https://github.com/nfarina/homebridge) installed. Refer to the repo for 
instructions.  
Then run the following command to install `homebridge-tesla-gateway`

```
sudo npm install -g homebridge-tesla-gateway
```

## Updating the sensor reading in HomeKit

Two Characteristincs are used:
* ChargingState - Used as a placeholder for if the GRID is online
* BatteryLevel - Displays the powerwall(s) charge level.

### The 'pull' way:

Currently defaults to pull every 150 seconds
Configuration option ( "pullInterval" ) will override default

## Configuration

The configuration can contain the following properties:

##### Basic configuration options:

* `accessory` \<string\> **required**: Defines the plugin used and must be set to **"HTTP-TESLA-GATEWAY"** for this plugin.
* `name` \<string\> **required**: Defines the name which is later displayed in HomeKit
* `getUrl` \<string |  [urlObject](#urlobject)\> **required**: Defines the url (and other properties when using 
    and urlObject) to query the current status from the Gateway

##### Advanced configuration options:

- `pullInterval` \<integer\> **optional**: The property expects an interval in **milliseconds** in which the plugin 
    pulls updates from your http device. For more information read [pulling updates](#the-pull-way).

Below is one example configuration. 
```json
{
    "accessories": [
        {
          "accessory": "HTTP-TESLA-GATEWAY",
          "name": "My Gateway",
          "pullInterval": "120000",
          "enableVerboseLogging": false,
          "strictSSL": false,
          "gatewayPassword" : "your password",
          "getUrl": "http://ip.to.gateway/api"
        }   
    ]
}
```

#### UrlObject

A urlObject can have the following properties:
* `url` \<string\> **required**: Defines the url pointing to your http server
* `method` \<string\> **optional** \(Default: **"GET"**\): Defines the http method used to make the http request
* `body` \<any\> **optional**: Defines the body sent with the http request. If value is not a string it will be
converted to a JSON string automatically.
* `strictSSL` \<boolean\> **optional** \(Default: **false**\): If enabled the SSL certificate used must be valid and 
the whole certificate chain must be trusted. The default is false because most people will work with self signed 
certificates in their homes and their devices are already authorized since being in their networks.
* `requestTimeout` \<number\> **optional** \(Default: **20000**\): Time in milliseconds specifying timeout (Time to wait
    for http response and also setting socket timeout).
  
Below is an example of an urlObject containing the basic properties:
```json
{
  "url": "http://example.com:8080",
  "method": "GET",
  "body": "exampleBody",
  
  "strictSSL": false,
  
  "auth": {
    "username": "yourUsername",
    "password": "yourPassword"
  },
  
  "headers": {
    "Content-Type": "text/html"
  }
}
```

