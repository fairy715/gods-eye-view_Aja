-- God's Eye View for macOS: a stay-open applet around the local server.
-- Opening the app starts the server (Contents/Resources/gev.sh) and opens
-- the map in the default browser; opening it again reopens the map;
-- quitting the app stops the server.

property serverURL : ""

on gevScript()
	return quoted form of (POSIX path of (path to me) & "Contents/Resources/gev.sh")
end gevScript

on openMap()
	try
		set serverURL to do shell script gevScript() & " start"
		open location serverURL
	on error errorText
		display alert "God's Eye View could not start" message errorText as critical
		quit
	end try
end openMap

on run
	openMap()
end run

on reopen
	openMap()
end reopen

on quit
	try
		do shell script gevScript() & " stop"
	end try
	continue quit
end quit
