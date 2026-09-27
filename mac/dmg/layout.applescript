-- The DMG's window, laid out by Finder: 640 x 400 of icon view over the
-- drawn background (background.py keeps the icon centres in step), no
-- toolbar, no sidebar, no status bar.
on run argv
	set volumeName to item 1 of argv
	tell application "Finder"
		tell disk volumeName
			open
			set current view of container window to icon view
			set toolbar visible of container window to false
			set statusbar visible of container window to false
			set pathbar visible of container window to false
			set sidebar width of container window to 0
			set the bounds of container window to {240, 160, 880, 560}
			set opts to the icon view options of container window
			set arrangement of opts to not arranged
			set icon size of opts to 112
			set text size of opts to 13
			set label position of opts to bottom
			set shows item info of opts to false
			set shows icon preview of opts to false
			set background picture of opts to file ".background:background.tiff"
			set position of item "justtype.app" of container window to {170, 196}
			set position of item "Applications" of container window to {470, 196}
			close
			open
			update without registering applications
			delay 2
			-- the window's content, as it came out, for a check
			set b to the bounds of container window
			close
		end tell
	end tell
	return b
end run
